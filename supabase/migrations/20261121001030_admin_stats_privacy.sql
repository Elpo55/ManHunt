-- =============================================================================
-- 1030 — Correction des statistiques par le propriétaire, fiche joueur
--         conforme au RGPD (v0.5.0)
--
-- Principes :
--  - correction des statistiques / succès : PROPRIÉTAIRE uniquement, motif
--    obligatoire, valeurs avant/après dans le journal d'audit, joueur informé
--    (avis dans son profil) ;
--  - minimisation des données (RGPD art. 5) : la fiche joueur montre ce qui
--    sert au fonctionnement et à la modération ; l'e-mail est masqué, et son
--    affichage complet est une action volontaire, motivée et journalisée ;
--    aucune position GPS.
-- =============================================================================

-- Avis adressés à un joueur (correction de statistiques, etc.).
create table if not exists public.account_notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  message    text not null,
  created_at timestamptz not null default now(),
  constraint account_notices_kind_check check (kind in ('correction'))
);
create index if not exists account_notices_user_idx on public.account_notices (user_id, created_at desc);
alter table public.account_notices enable row level security;
revoke all on public.account_notices from anon, authenticated, public;

create or replace function public.get_my_notices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(n.j order by n.at desc), '[]'::jsonb) from (
    select private.ms(created_at) as at,
           jsonb_build_object('id', id, 'kind', kind, 'reason', reason, 'starts_at', private.ms(starts_at),
             'ends_at', private.ms(ends_at), 'revoked', revoked_at is not null) as j
      from public.sanctions where user_id = auth.uid() and created_at > private.now_() - interval '90 days'
    union all
    select private.ms(created_at),
           jsonb_build_object('id', id, 'kind', kind, 'reason', message, 'starts_at', private.ms(created_at),
             'ends_at', null, 'revoked', false)
      from public.account_notices where user_id = auth.uid() and created_at > private.now_() - interval '90 days'
  ) n;
$$;

-- E-mail masqué : po*****@gmail.com
create or replace function private.mask_email(p_email text)
returns text language sql immutable set search_path = '' as $$
  select case when p_email is null or position('@' in p_email) = 0 then null
              else left(split_part(p_email, '@', 1), 2) || '*****@' || split_part(p_email, '@', 2) end;
$$;

-- -----------------------------------------------------------------------------
-- Fiche joueur (modérateur et plus) : + e-mail masqué, dernière activité,
-- succès, avis envoyés. Toujours aucune position.
-- -----------------------------------------------------------------------------
create or replace function public.admin_player_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_p public.profiles%rowtype;
  v_email text;
  v_email_confirmed boolean;
begin
  perform private.require_role('moderator');
  select * into v_p from public.profiles where id = p_user;
  if not found then perform private.fail('E_USER_NOT_FOUND'); end if;
  select u.email, u.email_confirmed_at is not null into v_email, v_email_confirmed from auth.users u where u.id = p_user;
  return jsonb_build_object(
    'profile', jsonb_build_object('id', v_p.id, 'username', v_p.username, 'avatar', v_p.avatar, 'role', v_p.role,
                 'is_guest', v_p.is_guest, 'created_at', private.ms(v_p.created_at),
                 'email_masked', private.mask_email(v_email), 'email_confirmed', coalesce(v_email_confirmed, false),
                 'last_seen_at', private.ms((select max(last_seen_at) from public.room_members where user_id = p_user)),
                 'games_played', v_p.games_played, 'wins', v_p.wins, 'losses', v_p.losses, 'draws', v_p.draws,
                 'captures', v_p.captures, 'times_captured', v_p.times_captured, 'survival_seconds', v_p.survival_seconds,
                 'total_score', v_p.total_score, 'objectives_total', v_p.objectives_total,
                 'win_streak', v_p.win_streak, 'best_streak', v_p.best_streak),
    'achievements', (select coalesce(jsonb_agg(jsonb_build_object('key', a.key, 'name', a.name,
                       'unlocked_at', private.ms(pa.unlocked_at)) order by a.sort_order), '[]'::jsonb)
                       from public.achievements a
                       left join public.player_achievements pa on pa.user_id = p_user and pa.key = a.key),
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
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('at', private.ms(a.created_at), 'reason', a.reason,
                       'action', a.action, 'result', a.result, 'by', (select username from public.profiles where id = a.actor_id))
                       order by a.id desc), '[]'::jsonb)
                      from public.admin_audit a
                     where a.target_type = 'user' and a.target_id = p_user::text and a.action in ('correct_stats', 'set_achievement')),
    'reports_against', (select count(*) from public.reports where target_user_id = p_user),
    'reports_open', (select count(*) from public.reports where target_user_id = p_user and status <> 'closed')
  );
end;
$$;

-- Affichage complet de l'e-mail : administrateur et plus, motif obligatoire, journalisé.
create or replace function public.admin_reveal_email(p_user uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_email text;
begin
  perform private.require_role('admin');
  perform private.rate_limit('reveal_email', 10, 3600000);
  select email into v_email from auth.users where id = p_user;
  if not found then perform private.fail('E_USER_NOT_FOUND'); end if;
  perform private.audit('reveal_email', 'user', p_user::text, v_reason);
  return v_email;
end;
$$;

-- -----------------------------------------------------------------------------
-- Correction des statistiques (propriétaire) — valeurs contrôlées, journalisées
-- -----------------------------------------------------------------------------
create or replace function public.admin_correct_stats(p_user uuid, p_changes jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_old public.profiles%rowtype;
  v_new public.profiles%rowtype;
  k text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_max numeric;
  v_allowed constant text[] := array['games_played', 'wins', 'losses', 'draws', 'captures', 'times_captured',
                                     'survival_seconds', 'total_score', 'objectives_total', 'win_streak', 'best_streak'];
begin
  perform private.require_role('owner');
  perform private.rate_limit('admin_action', 30, 60000);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then perform private.fail('E_INVALID_STATS'); end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not (k = any (v_allowed)) then perform private.fail('E_INVALID_STATS', k); end if;
    v_max := case when k in ('survival_seconds', 'total_score') then 1e9 else 1e6 end;
    if not private.is_num(p_changes -> k) or (p_changes ->> k)::numeric <> trunc((p_changes ->> k)::numeric)
       or (p_changes ->> k)::numeric < 0 or (p_changes ->> k)::numeric > v_max then
      perform private.fail('E_INVALID_STATS', k);
    end if;
  end loop;

  select * into v_old from public.profiles where id = p_user for update;
  if not found then perform private.fail('E_USER_NOT_FOUND'); end if;
  update public.profiles p set
    games_played     = coalesce((p_changes ->> 'games_played')::integer, p.games_played),
    wins             = coalesce((p_changes ->> 'wins')::integer, p.wins),
    losses           = coalesce((p_changes ->> 'losses')::integer, p.losses),
    draws            = coalesce((p_changes ->> 'draws')::integer, p.draws),
    captures         = coalesce((p_changes ->> 'captures')::integer, p.captures),
    times_captured   = coalesce((p_changes ->> 'times_captured')::integer, p.times_captured),
    survival_seconds = coalesce((p_changes ->> 'survival_seconds')::bigint, p.survival_seconds),
    total_score      = coalesce((p_changes ->> 'total_score')::bigint, p.total_score),
    objectives_total = coalesce((p_changes ->> 'objectives_total')::integer, p.objectives_total),
    win_streak       = coalesce((p_changes ->> 'win_streak')::integer, p.win_streak),
    best_streak      = coalesce((p_changes ->> 'best_streak')::integer, p.best_streak)
   where p.id = p_user
   returning * into v_new;

  -- Cohérence : victoires + défaites + nuls ≤ parties ; série en cours ≤ meilleure série ≤ victoires.
  if v_new.wins + v_new.losses + v_new.draws > v_new.games_played then perform private.fail('E_INVALID_STATS', 'wins+losses+draws>games_played'); end if;
  if v_new.win_streak > v_new.best_streak or v_new.best_streak > v_new.wins then perform private.fail('E_INVALID_STATS', 'streak'); end if;

  foreach k in array v_allowed loop
    if (to_jsonb(v_old) -> k) is distinct from (to_jsonb(v_new) -> k) then
      v_before := v_before || jsonb_build_object(k, to_jsonb(v_old) -> k);
      v_after := v_after || jsonb_build_object(k, to_jsonb(v_new) -> k);
    end if;
  end loop;
  if v_after = '{}'::jsonb then perform private.fail('E_INVALID_STATS', 'no_change'); end if;

  perform private.audit('correct_stats', 'user', p_user::text, v_reason, jsonb_build_object('before', v_before, 'after', v_after));
  insert into public.account_notices (user_id, kind, message, created_at)
  values (p_user, 'correction', 'Vos statistiques ont été corrigées par l''administration : ' || v_reason, private.now_());
  return jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

-- Attribuer / retirer un succès (propriétaire), journalisé, joueur informé.
create or replace function public.admin_set_achievement(p_user uuid, p_key text, p_unlocked boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := private.clean_reason(p_reason);
  v_name text;
  v_had boolean;
begin
  perform private.require_role('owner');
  perform private.rate_limit('admin_action', 30, 60000);
  select name into v_name from public.achievements where key = p_key;
  if not found then perform private.fail('E_NOT_FOUND', p_key); end if;
  if not exists (select 1 from public.profiles where id = p_user) then perform private.fail('E_USER_NOT_FOUND'); end if;
  v_had := exists (select 1 from public.player_achievements where user_id = p_user and key = p_key);
  if p_unlocked = v_had then perform private.fail('E_INVALID_STATS', 'no_change'); end if;
  if p_unlocked then
    insert into public.player_achievements (user_id, key, unlocked_at) values (p_user, p_key, private.now_());
  else
    delete from public.player_achievements where user_id = p_user and key = p_key;
  end if;
  perform private.audit('set_achievement', 'user', p_user::text, v_reason,
    jsonb_build_object('key', p_key, 'before', v_had, 'after', p_unlocked));
  insert into public.account_notices (user_id, kind, message, created_at)
  values (p_user, 'correction', 'Succès « ' || v_name || ' » ' || case when p_unlocked then 'attribué' else 'retiré' end
          || ' par l''administration : ' || v_reason, private.now_());
end;
$$;

revoke execute on function public.admin_reveal_email(uuid, text), public.admin_correct_stats(uuid, jsonb, text),
  public.admin_set_achievement(uuid, text, boolean, text), public.get_my_notices(), public.admin_player_detail(uuid)
  from public, anon;
grant execute on function public.admin_reveal_email(uuid, text), public.admin_correct_stats(uuid, jsonb, text),
  public.admin_set_achievement(uuid, text, boolean, text), public.get_my_notices(), public.admin_player_detail(uuid)
  to authenticated;
revoke execute on function private.mask_email(text) from public, anon, authenticated;
