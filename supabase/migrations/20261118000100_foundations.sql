-- =============================================================================
-- 0100 — Fondations : schéma privé, horloge serveur, limitation de fréquence,
--        compteurs d'usage (mesure de consommation des quotas).
-- =============================================================================
-- Le schéma `private` n'est PAS exposé par l'API PostgREST : il contient les
-- fonctions internes et les tables techniques inaccessibles aux clients.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated; -- nécessaire pour l'évaluation des politiques RLS

-- -----------------------------------------------------------------------------
-- Horloge serveur unique. Toutes les règles temporelles passent par ici.
-- `now()` est constant pendant une transaction : un même appel RPC voit un
-- temps cohérent. Les tests remplacent cette fonction pour piloter le temps.
-- -----------------------------------------------------------------------------
create or replace function private.now_()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now() $$;

-- Millisecondes epoch (utilisé dans les charges utiles Realtime).
create or replace function private.ms(ts timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$ select (extract(epoch from ts) * 1000)::bigint $$;

-- Lève une erreur applicative avec un code stable (préfixe E_) que le client
-- traduit en message lisible.
create or replace function private.fail(code text, detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = code, detail = coalesce(detail, '');
end;
$$;

-- -----------------------------------------------------------------------------
-- Limitation de fréquence par utilisateur et par « bucket » (fenêtre fixe).
-- -----------------------------------------------------------------------------
create table if not exists private.rate_limits (
  user_id      uuid        not null,
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (user_id, bucket)
);

create or replace function private.rate_limit(p_bucket text, p_max integer, p_window_ms integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := private.now_();
  v_row private.rate_limits%rowtype;
begin
  if v_uid is null then
    perform private.fail('E_NOT_AUTHENTICATED');
  end if;

  insert into private.rate_limits as r (user_id, bucket, window_start, hits)
  values (v_uid, p_bucket, v_now, 1)
  on conflict (user_id, bucket) do update
    set hits = case
                 when r.window_start + make_interval(secs => p_window_ms / 1000.0) <= v_now then 1
                 else r.hits + 1
               end,
        window_start = case
                 when r.window_start + make_interval(secs => p_window_ms / 1000.0) <= v_now then v_now
                 else r.window_start
               end
  returning * into v_row;

  if v_row.hits > p_max then
    perform private.fail('E_RATE_LIMITED', p_bucket);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Compteurs d'usage journaliers : estimation des messages Realtime et des
-- appels RPC, consultables par un administrateur (cf. get_usage_stats).
-- -----------------------------------------------------------------------------
create table if not exists private.usage_daily (
  day               date   primary key,
  rpc_calls         bigint not null default 0,
  broadcasts        bigint not null default 0,
  delivered_estimate bigint not null default 0
);

create or replace function private.count_usage(p_rpc integer, p_broadcasts integer, p_delivered integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.usage_daily as u (day, rpc_calls, broadcasts, delivered_estimate)
  values ((private.now_() at time zone 'utc')::date, p_rpc, p_broadcasts, p_delivered)
  on conflict (day) do update
    set rpc_calls = u.rpc_calls + excluded.rpc_calls,
        broadcasts = u.broadcasts + excluded.broadcasts,
        delivered_estimate = u.delivered_estimate + excluded.delivered_estimate;
$$;

-- Déterministe : nombre pseudo-aléatoire dans [0,1) dérivé d'une graine et
-- d'un discriminant. Utilisé pour la génération de carte (reproductible).
create or replace function private.hash01(p_seed bigint, p_key text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select (('x' || substr(md5(p_seed::text || ':' || p_key), 1, 8))::bit(32)::bigint)::double precision / 4294967296.0
$$;

-- Entier aléatoire (non déterministe) dans [lo, hi].
create or replace function private.rand_int(lo integer, hi integer)
returns integer
language sql
volatile
set search_path = ''
as $$ select lo + floor(random() * (hi - lo + 1))::integer $$;
