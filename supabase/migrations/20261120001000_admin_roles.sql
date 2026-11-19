-- =============================================================================
-- 1000 — Administration (v0.4.0)
--
-- Rôles globaux : owner (propriétaire) > admin > moderator > player.
-- L'hôte de partie reste un rôle contextuel (rooms.host_id), inchangé.
-- Toutes les permissions sont vérifiées ici, côté serveur.
--
-- Protection du gameplay : AUCUNE fonction d'administration ne lit ni ne
-- modifie une position, ne capture, ne déplace ni ne modifie un résultat.
-- Les seules interventions en partie (pause, reprise, terminaison sans
-- résultat compté) sont annoncées à tous les joueurs et journalisées.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rôles
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists role text not null default 'player';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner', 'admin', 'moderator', 'player'));

-- Le premier administrateur existant devient propriétaire (un seul propriétaire).
update public.profiles set role = 'owner'
 where id = (select id from public.profiles where is_admin order by created_at limit 1);
update public.profiles set role = 'admin' where is_admin and role = 'player';
create unique index if not exists profiles_single_owner on public.profiles ((role)) where role = 'owner';

-- is_admin reste synchronisé (compatibilité : get_usage_stats, admin_cleanup, client v0.3).
create or replace function private.sync_is_admin()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.is_admin := new.role in ('owner', 'admin');
  return new;
end;
$$;
drop trigger if exists profiles_sync_is_admin on public.profiles;
create trigger profiles_sync_is_admin before insert or update of role, is_admin on public.profiles
  for each row execute function private.sync_is_admin();
update public.profiles set role = role;

create or replace function private.role_rank(p_role text)
returns integer language sql immutable set search_path = '' as $$
  select case p_role when 'owner' then 4 when 'admin' then 3 when 'moderator' then 2 else 1 end;
$$;

create or replace function private.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'player');
$$;

/** Échoue si l'appelant n'a pas au moins le rôle demandé. */
create or replace function private.require_role(p_min text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.my_role();
begin
  if auth.uid() is null then perform private.fail('E_NOT_AUTHENTICATED'); end if;
  if private.role_rank(v_role) < private.role_rank(p_min) then perform private.fail('E_FORBIDDEN'); end if;
  return v_role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Journal d'audit (append-only, lisible par les modérateurs et plus)
-- -----------------------------------------------------------------------------
create table if not exists public.admin_audit (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_role   text not null,
  action       text not null,
  target_type  text not null,
  target_id    text,
  reason       text,
  result       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated, public;

create or replace function private.audit(p_action text, p_target_type text, p_target_id text, p_reason text, p_result jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit (actor_id, actor_role, action, target_type, target_id, reason, result, created_at)
  values (auth.uid(), private.my_role(), p_action, p_target_type, p_target_id, left(p_reason, 500), p_result, private.now_());
$$;

create or replace function private.clean_reason(p_reason text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := left(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), 500);
begin
  if char_length(v) < 3 then perform private.fail('E_REASON_REQUIRED'); end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sanctions : avertissement, suspension temporaire
-- -----------------------------------------------------------------------------
create table if not exists public.sanctions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null,
  reason        text not null,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles (id) on delete set null,
  revoke_reason text,
  constraint sanctions_kind_check check (kind in ('warning', 'suspension')),
  constraint sanctions_suspension_end check (kind <> 'suspension' or ends_at is not null)
);
create index if not exists sanctions_user_idx on public.sanctions (user_id, created_at desc);
alter table public.sanctions enable row level security;
revoke all on public.sanctions from anon, authenticated, public;

create or replace function private.active_suspension(p_user uuid)
returns public.sanctions language sql stable security definer set search_path = '' as $$
  select * from public.sanctions
   where user_id = p_user and kind = 'suspension' and revoked_at is null
     and starts_at <= private.now_() and ends_at > private.now_()
   order by ends_at desc limit 1;
$$;

-- Un compte suspendu ne peut plus créer ni rejoindre de salon (require_profile).
create or replace function private.require_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.profiles%rowtype;
  v_s public.sanctions%rowtype;
begin
  if auth.uid() is null then perform private.fail('E_NOT_AUTHENTICATED'); end if;
  select * into v_p from public.profiles where id = auth.uid();
  if not found or v_p.username is null then perform private.fail('E_PROFILE_INCOMPLETE'); end if;
  v_s := private.active_suspension(v_p.id);
  if v_s.id is not null then perform private.fail('E_SUSPENDED', private.ms(v_s.ends_at)::text); end if;
  return v_p;
end;
$$;

/** Cible sanctionnable : jamais soi-même, jamais un rang supérieur ou égal. */
create or replace function private.require_lower_rank(p_user uuid)
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  v_t public.profiles%rowtype;
begin
  select * into v_t from public.profiles where id = p_user;
  if not found then perform private.fail('E_USER_NOT_FOUND'); end if;
  if p_user = auth.uid() then perform private.fail('E_FORBIDDEN', 'self'); end if;
  if private.role_rank(v_t.role) >= private.role_rank(private.my_role()) then perform private.fail('E_FORBIDDEN', 'rank'); end if;
  return v_t;
end;
$$;

create or replace function public.admin_warn(p_user uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_id uuid;
begin
  perform private.require_role('moderator');
  perform private.require_lower_rank(p_user);
  perform private.rate_limit('admin_action', 30, 60000);
  insert into public.sanctions (user_id, kind, reason, created_by, starts_at, created_at)
  values (p_user, 'warning', v_reason, auth.uid(), private.now_(), private.now_()) returning id into v_id;
  perform private.audit('warn', 'user', p_user::text, v_reason, jsonb_build_object('sanction_id', v_id));
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_suspend(p_user uuid, p_hours integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_role text := private.require_role('moderator');
  v_id uuid;
  v_end timestamptz;
begin
  perform private.require_lower_rank(p_user);
  perform private.rate_limit('admin_action', 30, 60000);
  if p_hours is null or p_hours < 1 or p_hours > 24 * 90 then perform private.fail('E_INVALID_DURATION'); end if;
  -- Un modérateur est limité à 72 h ; au-delà, un administrateur est requis.
  if v_role = 'moderator' and p_hours > 72 then perform private.fail('E_FORBIDDEN', 'moderator_max_72h'); end if;
  v_end := private.now_() + make_interval(hours => p_hours);
  insert into public.sanctions (user_id, kind, reason, starts_at, ends_at, created_by, created_at)
  values (p_user, 'suspension', v_reason, private.now_(), v_end, auth.uid(), private.now_()) returning id into v_id;
  perform private.audit('suspend', 'user', p_user::text, v_reason, jsonb_build_object('sanction_id', v_id, 'hours', p_hours, 'ends_at', private.ms(v_end)));
  return jsonb_build_object('id', v_id, 'ends_at', private.ms(v_end));
end;
$$;

create or replace function public.admin_revoke_sanction(p_sanction uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_s public.sanctions%rowtype;
begin
  perform private.require_role('moderator');
  select * into v_s from public.sanctions where id = p_sanction for update;
  if not found then perform private.fail('E_NOT_FOUND'); end if;
  if v_s.revoked_at is not null then perform private.fail('E_ALREADY_REVOKED'); end if;
  perform private.require_lower_rank(v_s.user_id);
  update public.sanctions set revoked_at = private.now_(), revoked_by = auth.uid(), revoke_reason = v_reason where id = p_sanction;
  perform private.audit('revoke_sanction', 'user', v_s.user_id::text, v_reason, jsonb_build_object('sanction_id', p_sanction, 'kind', v_s.kind));
end;
$$;

-- Le joueur voit ses propres avertissements et suspensions.
create or replace function public.get_my_notices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'reason', reason, 'starts_at', private.ms(starts_at),
           'ends_at', private.ms(ends_at), 'revoked', revoked_at is not null) order by created_at desc), '[]'::jsonb)
    from public.sanctions where user_id = auth.uid() and created_at > private.now_() - interval '90 days';
$$;

-- -----------------------------------------------------------------------------
-- Rôles : attribution par le propriétaire uniquement
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_role(p_user uuid, p_role text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_old text;
begin
  perform private.require_role('owner');
  if p_role not in ('admin', 'moderator', 'player') then perform private.fail('E_INVALID_ROLE'); end if;
  if p_user = auth.uid() then perform private.fail('E_FORBIDDEN', 'self'); end if;
  select role into v_old from public.profiles where id = p_user for update;
  if not found then perform private.fail('E_USER_NOT_FOUND'); end if;
  update public.profiles set role = p_role where id = p_user;
  perform private.audit('set_role', 'user', p_user::text, v_reason, jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

-- -----------------------------------------------------------------------------
-- Signalements
-- -----------------------------------------------------------------------------
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete cascade,
  game_id        uuid references public.games (id) on delete set null,
  room_id        uuid references public.rooms (id) on delete set null,
  category       text not null,
  message        text not null,
  status         text not null default 'open',
  resolution     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      uuid references public.profiles (id) on delete set null,
  constraint reports_category_check check (category in ('cheating', 'behaviour', 'unsafe', 'name', 'bug', 'other')),
  constraint reports_status_check check (status in ('open', 'in_review', 'closed'))
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create table if not exists public.report_notes (
  id         bigint generated always as identity primary key,
  report_id  uuid not null references public.reports (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  note       text not null,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
alter table public.report_notes enable row level security;
revoke all on public.reports, public.report_notes from anon, authenticated, public;

create or replace function public.report_player(p_target uuid, p_category text, p_message text, p_game uuid default null, p_room uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_msg text := left(btrim(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]', ' ', 'g')), 1000);
begin
  perform private.require_profile();
  perform private.rate_limit('report', 5, 3600000);
  if p_category not in ('cheating', 'behaviour', 'unsafe', 'name', 'bug', 'other') then perform private.fail('E_INVALID_CATEGORY'); end if;
  if char_length(v_msg) < 5 then perform private.fail('E_REASON_REQUIRED'); end if;
  if p_target is not null and p_target = auth.uid() then perform private.fail('E_FORBIDDEN', 'self'); end if;
  if p_target is not null and not exists (select 1 from public.profiles where id = p_target) then perform private.fail('E_USER_NOT_FOUND'); end if;
  -- On ne signale que dans un contexte partagé (même salon / même partie) ou un bug.
  if p_game is not null and not private.is_participant(p_game) then perform private.fail('E_NOT_PARTICIPANT'); end if;
  if p_room is not null and not private.is_room_member(p_room, auth.uid()) then perform private.fail('E_NOT_MEMBER'); end if;
  insert into public.reports (reporter_id, target_user_id, game_id, room_id, category, message, created_at, updated_at)
  values (auth.uid(), p_target, p_game, p_room, p_category, v_msg, private.now_(), private.now_()) returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_reports(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role('moderator');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'category', r.category, 'message', r.message, 'status', r.status, 'resolution', r.resolution,
             'created_at', private.ms(r.created_at), 'closed_at', private.ms(r.closed_at),
             'reporter', jsonb_build_object('id', rp.id, 'username', rp.username),
             'target', case when t.id is null then null else jsonb_build_object('id', t.id, 'username', t.username, 'role', t.role) end,
             'game_id', r.game_id, 'room_id', r.room_id,
             'notes', (select coalesce(jsonb_agg(jsonb_build_object('note', n.note, 'at', private.ms(n.created_at),
                                 'author', (select username from public.profiles where id = n.author_id)) order by n.id), '[]'::jsonb)
                         from public.report_notes n where n.report_id = r.id)
           ) order by (r.status = 'closed'), r.created_at desc)
      from (select * from public.reports where p_status is null or status = p_status order by created_at desc limit 200) r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles t on t.id = r.target_user_id), '[]'::jsonb);
end;
$$;

create or replace function public.admin_report_note(p_report uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_note text := private.clean_reason(p_note);
begin
  perform private.require_role('moderator');
  if not exists (select 1 from public.reports where id = p_report) then perform private.fail('E_NOT_FOUND'); end if;
  insert into public.report_notes (report_id, author_id, note, created_at) values (p_report, auth.uid(), v_note, private.now_());
  update public.reports set status = case when status = 'open' then 'in_review' else status end, updated_at = private.now_() where id = p_report;
  perform private.audit('report_note', 'report', p_report::text, v_note);
end;
$$;

create or replace function public.admin_report_status(p_report uuid, p_status text, p_resolution text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_res text := private.clean_reason(p_resolution);
  v_old text;
begin
  perform private.require_role('moderator');
  if p_status not in ('open', 'in_review', 'closed') then perform private.fail('E_INVALID_STATUS'); end if;
  select status into v_old from public.reports where id = p_report for update;
  if not found then perform private.fail('E_NOT_FOUND'); end if;
  update public.reports
     set status = p_status, resolution = v_res, updated_at = private.now_(),
         closed_at = case when p_status = 'closed' then private.now_() end,
         closed_by = case when p_status = 'closed' then auth.uid() end
   where id = p_report;
  perform private.audit('report_status', 'report', p_report::text, v_res, jsonb_build_object('from', v_old, 'to', p_status));
end;
$$;

-- -----------------------------------------------------------------------------
-- Paramètres globaux (modifiables par les administrateurs, journalisés)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_settings_key_check check (key in ('limits', 'defaults', 'features', 'notifications', 'announcement'))
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated, public;

insert into public.app_settings (key, value) values
  ('limits', '{"max_players": 20, "max_rooms_per_user": 10}'),
  ('defaults', '{"duration_s": 1800, "prep_s": 120, "max_players": 20}'),
  ('features', '{"royale": true, "misterx": true, "qr_capture": true, "objectives": true, "replay": true, "spectators": true, "training": false}'),
  ('notifications', '{"proximity_m": 75, "min_interval_s": 30}'),
  ('announcement', '{"text": "", "level": "info"}')
on conflict (key) do nothing;

create or replace function private.setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.app_settings where key = p_key), '{}'::jsonb);
$$;

create or replace function private.feature_on(p_flag text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((private.setting('features') ->> p_flag)::boolean, true);
$$;

-- Lecture publique (aucune donnée sensible) : utilisée par l'application au démarrage.
create or replace function public.get_app_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.app_settings;
$$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_old jsonb;
  v_mp integer;
begin
  perform private.require_role('admin');
  if jsonb_typeof(p_value) <> 'object' or pg_column_size(p_value) > 4096 then perform private.fail('E_INVALID_SETTING'); end if;
  if p_key = 'limits' then
    v_mp := (p_value ->> 'max_players')::integer;
    if v_mp is null or v_mp < 2 or v_mp > 20 then perform private.fail('E_INVALID_SETTING', 'max_players 2..20'); end if;
  elsif p_key = 'defaults' then
    p_value := jsonb_build_object(
      'duration_s', private.cfg_int(p_value, 'duration_s', 1800, 300, 7200),
      'prep_s', private.cfg_int(p_value, 'prep_s', 120, 0, 900),
      'max_players', private.cfg_int(p_value, 'max_players', 20, 2, 20));
  elsif p_key = 'announcement' then
    p_value := jsonb_build_object('text', left(coalesce(p_value ->> 'text', ''), 280),
                                  'level', case when p_value ->> 'level' in ('info', 'warn') then p_value ->> 'level' else 'info' end);
  elsif p_key not in ('features', 'notifications') then
    perform private.fail('E_INVALID_SETTING');
  end if;
  select value into v_old from public.app_settings where key = p_key;
  insert into public.app_settings (key, value, updated_by, updated_at) values (p_key, p_value, auth.uid(), private.now_())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform private.audit('set_setting', 'setting', p_key, v_reason, jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;

-- Limite globale de joueurs appliquée à chaque salon (création et modification).
create or replace function private.enforce_room_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cap integer := coalesce((private.setting('limits') ->> 'max_players')::integer, 20);
begin
  if new.max_players > v_cap then perform private.fail('E_MAX_PLAYERS_LIMIT', v_cap::text); end if;
  return new;
end;
$$;
drop trigger if exists rooms_enforce_limits on public.rooms;
create trigger rooms_enforce_limits before insert or update of max_players on public.rooms
  for each row execute function private.enforce_room_limits();

-- -----------------------------------------------------------------------------
-- Versions publiées (alerte de mise à jour, distribution hors store)
-- -----------------------------------------------------------------------------
create table if not exists public.app_releases (
  id                  uuid primary key default gen_random_uuid(),
  platform            text not null default 'android',
  version             text not null,
  build               integer not null,
  severity            text not null default 'optional',
  min_supported_build integer,
  url                 text,
  notes               text not null default '',
  published_by        uuid references public.profiles (id) on delete set null,
  published_at        timestamptz not null default now(),
  constraint app_releases_platform_check check (platform in ('android', 'ios')),
  constraint app_releases_version_check check (version ~ '^\d+\.\d+\.\d+$'),
  constraint app_releases_severity_check check (severity in ('optional', 'recommended', 'critical')),
  constraint app_releases_url_check check (url is null or url ~ '^https://'),
  constraint app_releases_unique unique (platform, build)
);
alter table public.app_releases enable row level security;
revoke all on public.app_releases from anon, authenticated, public;

/**
 * Dernière version publiée. Lisible sans connexion (vérification au lancement).
 * La comparaison se fait sur le numéro de build ; le serveur ne se fie jamais à
 * la version déclarée par le client pour un contrôle de sécurité (information seulement).
 */
create or replace function public.get_latest_release(p_platform text default 'android')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('version', r.version, 'build', r.build, 'severity', r.severity,
             'min_supported_build', r.min_supported_build, 'url', r.url, 'notes', r.notes,
             'published_at', private.ms(r.published_at))
      from public.app_releases r where r.platform = p_platform order by r.build desc limit 1), 'null'::jsonb);
$$;

create or replace function public.admin_publish_release(p_platform text, p_version text, p_severity text, p_url text, p_notes text, p_min_supported_build integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m text[] := regexp_match(coalesce(p_version, ''), '^(\d+)\.(\d+)\.(\d+)$');
  v_build integer;
  v_id uuid;
begin
  perform private.require_role('admin');
  if m is null or m[2]::integer > 99 or m[3]::integer > 99 then perform private.fail('E_INVALID_VERSION'); end if;
  v_build := m[1]::integer * 10000 + m[2]::integer * 100 + m[3]::integer;
  if p_url is not null and p_url !~ '^https://' then perform private.fail('E_INVALID_URL'); end if;
  insert into public.app_releases (platform, version, build, severity, min_supported_build, url, notes, published_by, published_at)
  values (p_platform, p_version, v_build, p_severity, p_min_supported_build, nullif(p_url, ''), left(coalesce(p_notes, ''), 2000), auth.uid(), private.now_())
  on conflict (platform, build) do update
    set severity = excluded.severity, min_supported_build = excluded.min_supported_build, url = excluded.url,
        notes = excluded.notes, published_by = excluded.published_by, published_at = excluded.published_at
  returning id into v_id;
  perform private.audit('publish_release', 'release', p_platform || ':' || p_version, coalesce(p_notes, ''),
                        jsonb_build_object('build', v_build, 'severity', p_severity, 'url', p_url));
  return jsonb_build_object('id', v_id, 'build', v_build);
end;
$$;

-- -----------------------------------------------------------------------------
-- Erreurs remontées par l'application (diagnostic, conservées 14 jours)
-- -----------------------------------------------------------------------------
create table if not exists private.client_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  code        text not null,
  context     text,
  app_version text,
  created_at  timestamptz not null default now()
);
create index if not exists client_errors_created_idx on private.client_errors (created_at desc);

create or replace function public.log_client_error(p_code text, p_context text, p_app_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  perform private.rate_limit('client_error', 10, 60000);
  insert into private.client_errors (user_id, code, context, app_version, created_at)
  values (auth.uid(), left(coalesce(p_code, '?'), 40), left(p_context, 300), left(p_app_version, 20), private.now_());
end;
$$;

-- -----------------------------------------------------------------------------
-- Tableau de bord
-- -----------------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_now timestamptz := private.now_();
  v_cron jsonb := null;
  v_rt integer := null;
begin
  perform private.require_role('moderator');
  if to_regclass('cron.job_run_details') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'status', d.status, 'at', private.ms(d.end_time))), '[]'::jsonb)
                 from cron.job j
                 left join lateral (select status, end_time from cron.job_run_details r where r.jobid = j.jobid
                                     order by r.start_time desc limit 1) d on true$q$ into v_cron;
  end if;
  if to_regclass('realtime.messages') is not null then
    execute $q$select count(*)::integer from realtime.messages where inserted_at > $1 - interval '10 minutes'$q$ into v_rt using v_now;
  end if;
  return jsonb_build_object(
    'server_now', private.ms(v_now),
    'players_total', (select count(*) from public.profiles where username is not null),
    'players_online', (select count(distinct user_id) from public.room_members where last_seen_at > v_now - interval '2 minutes'),
    'games_live', (select count(*) from public.games where phase <> 'finished'),
    'rooms_active', (select count(*) from public.rooms where status in ('lobby', 'playing')
                       and last_activity_at > v_now - interval '24 hours'),
    'games_finished_7d', (select count(*) from public.games where phase = 'finished' and ended_at > v_now - interval '7 days'),
    'reports_open', (select count(*) from public.reports where status <> 'closed'),
    'suspensions_active', (select count(*) from public.sanctions where kind = 'suspension' and revoked_at is null and ends_at > v_now),
    'database_bytes', pg_database_size(current_database()),
    'realtime_messages_10min', v_rt,
    'cron', v_cron,
    'errors', (select coalesce(jsonb_agg(jsonb_build_object('code', e.code, 'context', e.context, 'version', e.app_version,
                                 'at', private.ms(e.created_at)) order by e.id desc), '[]'::jsonb)
                 from (select * from private.client_errors order by id desc limit 20) e),
    'errors_24h', (select count(*) from private.client_errors where created_at > v_now - interval '24 hours')
  );
end;
$$;

create or replace function public.admin_search_players(p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := left(btrim(coalesce(p_query, '')), 40);
begin
  perform private.require_role('moderator');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'role', p.role, 'is_guest', p.is_guest,
             'games_played', p.games_played, 'wins', p.wins, 'created_at', private.ms(p.created_at),
             'suspended_until', private.ms((private.active_suspension(p.id)).ends_at)) order by p.username)
      from (select * from public.profiles
             where username is not null and (v_q = '' or username ilike '%' || replace(replace(v_q, '%', ''), '_', '\_') || '%')
             order by username limit 50) p), '[]'::jsonb);
end;
$$;

create or replace function public.admin_player_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_p public.profiles%rowtype;
begin
  perform private.require_role('moderator');
  select * into v_p from public.profiles where id = p_user;
  if not found then perform private.fail('E_USER_NOT_FOUND'); end if;
  return jsonb_build_object(
    'profile', jsonb_build_object('id', v_p.id, 'username', v_p.username, 'avatar', v_p.avatar, 'role', v_p.role,
                 'is_guest', v_p.is_guest, 'created_at', private.ms(v_p.created_at),
                 'games_played', v_p.games_played, 'wins', v_p.wins, 'losses', v_p.losses, 'draws', v_p.draws,
                 'captures', v_p.captures, 'times_captured', v_p.times_captured, 'survival_seconds', v_p.survival_seconds,
                 'total_score', v_p.total_score),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('game_id', st.game_id, 'mode', g.mode, 'team', st.initial_team,
                       'outcome', st.outcome, 'score', st.score, 'captures', st.captures, 'counted', st.counted,
                       'at', private.ms(st.created_at)) order by st.created_at desc), '[]'::jsonb)
                from (select * from public.game_statistics where user_id = p_user order by created_at desc limit 30) st
                join public.games g on g.id = st.game_id),
    'sanctions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'reason', s.reason,
                       'starts_at', private.ms(s.starts_at), 'ends_at', private.ms(s.ends_at),
                       'by', (select username from public.profiles where id = s.created_by),
                       'revoked_at', private.ms(s.revoked_at), 'revoke_reason', s.revoke_reason) order by s.created_at desc), '[]'::jsonb)
                    from public.sanctions s where s.user_id = p_user),
    'reports_against', (select count(*) from public.reports where target_user_id = p_user),
    'reports_open', (select count(*) from public.reports where target_user_id = p_user and status <> 'closed')
  );
end;
$$;

-- Parties et salons : participants, équipes, paramètres. Jamais de position.
create or replace function public.admin_games()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role('moderator');
  return jsonb_build_object(
    'games', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', g.id, 'room_id', g.room_id, 'room_name', r.name, 'code', r.code, 'mode', g.mode, 'phase', g.phase,
                'started_at', private.ms(g.started_at), 'phase_ends_at', private.ms(g.phase_ends_at),
                'host', (select username from public.profiles where id = r.host_id),
                'players', (select count(*) from public.player_states where game_id = g.id),
                'active', (select count(*) from public.player_states where game_id = g.id and status = 'active'),
                'updated_at', private.ms(g.updated_at)) order by g.started_at desc), '[]'::jsonb)
                from public.games g join public.rooms r on r.id = g.room_id where g.phase <> 'finished'),
    'rooms', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', r.id, 'name', r.name, 'code', r.code, 'status', r.status,
                'host', (select username from public.profiles where id = r.host_id),
                'members', (select count(*) from public.room_members where room_id = r.id),
                'last_activity_at', private.ms(r.last_activity_at)) order by r.last_activity_at desc), '[]'::jsonb)
                from (select * from public.rooms where status <> 'closed' order by last_activity_at desc limit 100) r)
  );
end;
$$;

create or replace function public.admin_game_detail(p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
begin
  perform private.require_role('moderator');
  select * into v_g from public.games where id = p_game;
  if not found then perform private.fail('E_GAME_NOT_FOUND'); end if;
  return jsonb_build_object(
    'game', jsonb_build_object('id', v_g.id, 'room_id', v_g.room_id, 'mode', v_g.mode, 'phase', v_g.phase,
              -- Paramètres sans aucune coordonnée (zone, balises, rendez-vous résumés).
              'config', (v_g.config - 'zone' - 'objectives' - 'rendezvous') || jsonb_build_object(
                        'zone', jsonb_build_object('label', v_g.config -> 'zone' ->> 'label', 'radius_m', v_g.config -> 'zone' -> 'radius_m',
                                  'shape', v_g.config -> 'zone' ->> 'shape',
                                  'forbidden', jsonb_array_length(coalesce(v_g.config -> 'zone' -> 'forbidden', '[]'::jsonb))),
                        'objectives', jsonb_build_object('enabled', v_g.config -> 'objectives' -> 'enabled',
                                  'beacons', jsonb_array_length(coalesce(v_g.config -> 'objectives' -> 'beacons', '[]'::jsonb)),
                                  'extraction', v_g.config -> 'objectives' -> 'extraction' -> 'set'),
                        'rendezvous', v_g.config -> 'rendezvous' -> 'set'),
              'started_at', private.ms(v_g.started_at), 'phase_ends_at', private.ms(v_g.phase_ends_at),
              'winner', v_g.winner, 'end_reason', v_g.end_reason),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('u', ps.user_id, 'username', p.username, 'team', ps.team,
                  'initial_team', ps.initial_team, 'status', ps.status, 'connected', ps.connected,
                  'last_seen_at', private.ms(ps.last_seen_at), 'captures', ps.captures) order by ps.team, p.username), '[]'::jsonb)
                  from public.player_states ps join public.profiles p on p.id = ps.user_id where ps.game_id = p_game),
    'admin_events', (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'at', private.ms(a.created_at),
                       'by', (select username from public.profiles where id = a.actor_id)) order by a.id), '[]'::jsonb)
                       from public.admin_audit a where a.target_type = 'game' and a.target_id = p_game::text)
  );
end;
$$;

-- Pause / reprise internes (communes à l'hôte, à l'administration et au SOS).
create or replace function private.do_pause(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
begin
  perform private.tick(p_game);
  select * into v_g from public.games where id = p_game for update;
  if v_g.phase not in ('preparation', 'running') then perform private.fail('E_INVALID_TRANSITION'); end if;
  update public.games
     set paused_from = phase, phase = 'paused', paused_at = v_now,
         paused_remaining_ms = greatest(0, private.ms(phase_ends_at) - private.ms(v_now))::integer,
         radar_remaining_ms = case when next_radar_at is null then null
                                   else greatest(0, private.ms(next_radar_at) - private.ms(v_now))::integer end,
         phase_ends_at = null, next_radar_at = null, phase_started_at = v_now
   where id = p_game;
  perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
end;
$$;

create or replace function private.do_resume(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_delta interval;
begin
  select * into v_g from public.games where id = p_game for update;
  if v_g.phase <> 'paused' then perform private.fail('E_INVALID_TRANSITION'); end if;
  v_delta := v_now - v_g.paused_at;
  update public.games
     set phase = paused_from,
         phase_started_at = v_now,
         phase_ends_at = v_now + make_interval(secs => paused_remaining_ms / 1000.0),
         next_radar_at = case when radar_remaining_ms is null then null
                              else v_now + make_interval(secs => radar_remaining_ms / 1000.0) end,
         team_state = (select coalesce(jsonb_object_agg(k, case when v ? 'radar_last'
                                 then jsonb_set(v, '{radar_last}', to_jsonb((v ->> 'radar_last')::bigint + private.ms(v_now) - private.ms(v_g.paused_at)))
                                 else v end), '{}'::jsonb)
                         from jsonb_each(team_state) as t(k, v)),
         paused_at = null, paused_from = null, paused_remaining_ms = null, radar_remaining_ms = null
   where id = p_game;
  -- Effets, temps de recharge et délais gelés pendant la pause.
  update public.player_states
     set ghost_until = case when ghost_until > v_g.paused_at then ghost_until + v_delta else ghost_until end,
         jam_until = case when jam_until > v_g.paused_at then jam_until + v_delta else jam_until end,
         decoy_until = case when decoy_until > v_g.paused_at then decoy_until + v_delta else decoy_until end,
         boost_until = case when boost_until > v_g.paused_at then boost_until + v_delta else boost_until end,
         out_of_zone_since = case when out_of_zone_since is not null then out_of_zone_since + v_delta end,
         last_capture_at = last_capture_at + v_delta,
         steps_at = steps_at + v_delta,
         last_seen_at = greatest(last_seen_at, v_now - interval '30 seconds')
   where game_id = p_game;
  update public.ability_usage set used_at = used_at + v_delta, expires_at = expires_at + v_delta where game_id = p_game;
  update public.map_effects set expires_at = expires_at + v_delta where game_id = p_game;
  update public.radar_pulses set expires_at = expires_at + v_delta where game_id = p_game and expires_at > v_g.paused_at;
  perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
end;
$$;

create or replace function public.resume_game(p_game uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_game_as_host(p_game);
  perform private.do_resume(p_game);
  return private.phase_payload(p_game);
end;
$$;

-- L'hôte, l'administration : même logique de pause.
create or replace function public.pause_game(p_game uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_game_as_host(p_game);
  perform private.do_pause(p_game);
  return private.phase_payload(p_game);
end;
$$;

/** Annonce une intervention administrative à TOUS les joueurs de la partie. */
create or replace function private.announce_admin(p_game uuid, p_action text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  select private.emit(p_game, 'all', 'admin_action', jsonb_build_object('action', p_action, 'reason', p_reason,
           'role', private.my_role(), 'at', private.ms(private.now_())));
$$;

create or replace function public.admin_pause_game(p_game uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
begin
  perform private.require_role('admin');
  perform private.do_pause(p_game);
  perform private.announce_admin(p_game, 'pause', v_reason);
  perform private.audit('pause_game', 'game', p_game::text, v_reason);
end;
$$;

create or replace function public.admin_resume_game(p_game uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_host uuid;
begin
  perform private.require_role('admin');
  select r.host_id into v_host from public.games g join public.rooms r on r.id = g.room_id where g.id = p_game;
  if v_host is null then perform private.fail('E_GAME_NOT_FOUND'); end if;
  perform private.do_resume(p_game);
  perform private.announce_admin(p_game, 'resume', v_reason);
  perform private.audit('resume_game', 'game', p_game::text, v_reason);
end;
$$;

-- Terminaison d'une partie bloquée : égalité NON comptée (aucun résultat modifié).
create or replace function public.admin_end_game(p_game uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_phase text;
begin
  perform private.require_role('admin');
  select phase into v_phase from public.games where id = p_game for update;
  if not found then perform private.fail('E_GAME_NOT_FOUND'); end if;
  if v_phase = 'finished' then perform private.fail('E_GAME_FINISHED'); end if;
  perform private.announce_admin(p_game, 'end', v_reason);
  perform private.finish_game(p_game, 'draw', 'aborted');
  perform private.audit('end_game', 'game', p_game::text, v_reason);
end;
$$;

create or replace function public.admin_close_room(p_room uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_room public.rooms%rowtype;
begin
  perform private.require_role('admin');
  select * into v_room from public.rooms where id = p_room for update;
  if not found then perform private.fail('E_ROOM_NOT_FOUND'); end if;
  if v_room.current_game_id is not null and exists (select 1 from public.games where id = v_room.current_game_id and phase <> 'finished') then
    perform private.announce_admin(v_room.current_game_id, 'end', v_reason);
    perform private.finish_game(v_room.current_game_id, 'draw', 'aborted');
  end if;
  update public.rooms set status = 'closed' where id = p_room;
  perform private.room_emit(p_room, 'room_closed', jsonb_build_object('reason', v_reason));
  perform private.audit('close_room', 'room', p_room::text, v_reason);
end;
$$;

create or replace function public.admin_audit_log(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role('moderator');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
             'reason', a.reason, 'result', a.result, 'at', private.ms(a.created_at), 'role', a.actor_role,
             'actor', (select username from public.profiles where id = a.actor_id)) order by a.id desc)
      from (select * from public.admin_audit order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) a), '[]'::jsonb);
end;
$$;

-- Mon rôle (pour l'interface ; chaque RPC revérifie de toute façon).
create or replace function public.get_my_role()
returns text language sql stable security definer set search_path = '' as $$
  select private.my_role();
$$;

-- -----------------------------------------------------------------------------
-- Privilèges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.is_room_member(uuid, uuid), private.my_team(uuid), private.is_participant(uuid),
  private.game_finished(uuid), private.is_room_host(uuid), private.can_see_game(uuid),
  private.can_access_topic(text, text, boolean), private.team_topic(uuid, text),
  private.is_positional_event(text)
  to authenticated;

revoke execute on function
  public.admin_warn(uuid, text), public.admin_suspend(uuid, integer, text), public.admin_revoke_sanction(uuid, text),
  public.get_my_notices(), public.admin_set_role(uuid, text, text), public.report_player(uuid, text, text, uuid, uuid),
  public.admin_reports(text), public.admin_report_note(uuid, text), public.admin_report_status(uuid, text, text),
  public.get_app_settings(), public.admin_set_setting(text, jsonb, text), public.get_latest_release(text),
  public.admin_publish_release(text, text, text, text, text, integer), public.log_client_error(text, text, text),
  public.admin_overview(), public.admin_search_players(text), public.admin_player_detail(uuid), public.admin_games(),
  public.admin_game_detail(uuid), public.admin_pause_game(uuid, text), public.admin_resume_game(uuid, text),
  public.admin_end_game(uuid, text), public.admin_close_room(uuid, text), public.admin_audit_log(integer),
  public.get_my_role(), public.pause_game(uuid)
  from public, anon;
grant execute on function
  public.admin_warn(uuid, text), public.admin_suspend(uuid, integer, text), public.admin_revoke_sanction(uuid, text),
  public.get_my_notices(), public.admin_set_role(uuid, text, text), public.report_player(uuid, text, text, uuid, uuid),
  public.admin_reports(text), public.admin_report_note(uuid, text), public.admin_report_status(uuid, text, text),
  public.get_app_settings(), public.admin_set_setting(text, jsonb, text), public.get_latest_release(text),
  public.admin_publish_release(text, text, text, text, text, integer), public.log_client_error(text, text, text),
  public.admin_overview(), public.admin_search_players(text), public.admin_player_detail(uuid), public.admin_games(),
  public.admin_game_detail(uuid), public.admin_pause_game(uuid, text), public.admin_resume_game(uuid, text),
  public.admin_end_game(uuid, text), public.admin_close_room(uuid, text), public.admin_audit_log(integer),
  public.get_my_role(), public.pause_game(uuid)
  to authenticated;
-- Vérification de mise à jour possible avant connexion, paramètres publics aussi.
grant execute on function public.get_latest_release(text), public.get_app_settings() to anon;
