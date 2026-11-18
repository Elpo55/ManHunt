-- =============================================================================
-- 0600 — Sécurité : Row Level Security, privilèges, autorisation Realtime.
--
-- Modèle :
--  * Aucune écriture directe sur les tables de jeu : tout passe par les RPC
--    `security definer` qui valident chaque action.
--  * Lecture directe limitée par RLS (membre du salon, participant, équipe).
--  * Les positions adverses ne sont lisibles ni par table, ni par Realtime.
--  * Les canaux Realtime sont PRIVÉS ; l'accès à chaque topic est décidé par
--    les politiques sur realtime.messages.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers (security definer pour éviter la récursion RLS)
-- -----------------------------------------------------------------------------
create or replace function private.my_team(p_game uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select team from public.player_states where game_id = p_game and user_id = auth.uid() $$;

create or replace function private.is_participant(p_game uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.player_states where game_id = p_game and user_id = auth.uid()) $$;

create or replace function private.game_finished(p_game uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select phase = 'finished' from public.games where id = p_game), false) $$;

create or replace function private.is_room_host(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.rooms where id = p_room and host_id = auth.uid()) $$;

create or replace function private.can_see_game(p_game uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_participant(p_game)
      or exists (select 1 from public.games g join public.room_members m on m.room_id = g.room_id
                  where g.id = p_game and m.user_id = auth.uid())
$$;

-- Autorisation d'un topic Realtime.
--   room:<room_id>                  -> membre du salon (broadcast + presence)
--   game:<game_id>:all              -> participant (broadcast + presence)
--   game:<game_id>:hunter|fugitive  -> participant de cette équipe (broadcast)
--   game:<game_id>:p:<user_id>      -> ce joueur uniquement (broadcast)
create or replace function private.can_access_topic(p_topic text, p_extension text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_id text := split_part(p_topic, ':', 2);
  v_scope text := split_part(p_topic, ':', 3);
  v_target text := split_part(p_topic, ':', 4);
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null or p_topic is null or v_id !~ v_uuid_re then
    return false;
  end if;
  -- Les clients ne peuvent écrire que de la présence ; jamais de broadcast.
  if p_write and p_extension <> 'presence' then
    return false;
  end if;

  if v_kind = 'room' and v_scope = '' then
    return private.is_room_member(v_id::uuid, auth.uid());
  end if;

  if v_kind = 'game' then
    if v_scope = 'all' and v_target = '' then
      return private.is_participant(v_id::uuid);
    end if;
    if p_extension = 'presence' then
      return false;
    end if;
    if v_scope in ('hunter', 'fugitive') and v_target = '' then
      return private.my_team(v_id::uuid) = v_scope;
    end if;
    if v_scope = 'p' and v_target = auth.uid()::text then
      return private.is_participant(v_id::uuid);
    end if;
  end if;
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Activation RLS
-- -----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.rooms               enable row level security;
alter table public.room_members        enable row level security;
alter table public.room_bans           enable row level security;
alter table public.abilities           enable row level security;
alter table public.games               enable row level security;
alter table public.player_states       enable row level security;
alter table public.game_events         enable row level security;
alter table public.ability_usage       enable row level security;
alter table public.radar_pulses        enable row level security;
alter table public.map_effects         enable row level security;
alter table public.game_statistics     enable row level security;
alter table public.saved_game_configs  enable row level security;
alter table private.rate_limits        enable row level security;
alter table private.usage_daily        enable row level security;

-- -----------------------------------------------------------------------------
-- Politiques
-- -----------------------------------------------------------------------------
create policy profiles_read on public.profiles
  for select to authenticated using (true);

create policy rooms_read on public.rooms
  for select to authenticated using (private.is_room_member(id, (select auth.uid())));

create policy room_members_read on public.room_members
  for select to authenticated using (private.is_room_member(room_id, (select auth.uid())));

create policy room_bans_read on public.room_bans
  for select to authenticated using (private.is_room_host(room_id));

create policy abilities_read on public.abilities
  for select to authenticated using (true);

create policy games_read on public.games
  for select to authenticated using (private.can_see_game(id));

-- Soi-même, ses coéquipiers, ou tout le monde une fois la partie terminée.
create policy player_states_read on public.player_states
  for select to authenticated using (
    user_id = (select auth.uid())
    or team = private.my_team(game_id)
    or (private.game_finished(game_id) and private.can_see_game(game_id))
  );

create policy game_events_read on public.game_events
  for select to authenticated using (
    private.is_participant(game_id) and (
      stream = 'all'
      or stream = private.my_team(game_id)
      or stream = 'p:' || (select auth.uid())::text
      or private.game_finished(game_id)
    )
  );

create policy ability_usage_read on public.ability_usage
  for select to authenticated using (
    private.is_participant(game_id) and (team = private.my_team(game_id) or private.game_finished(game_id))
  );

create policy radar_pulses_read on public.radar_pulses
  for select to authenticated using (
    private.is_participant(game_id) and (team = private.my_team(game_id) or private.game_finished(game_id))
  );

create policy map_effects_read on public.map_effects
  for select to authenticated using (private.is_participant(game_id));

create policy game_statistics_read on public.game_statistics
  for select to authenticated using (true);

create policy saved_configs_select on public.saved_game_configs
  for select to authenticated using (owner_id = (select auth.uid()));
create policy saved_configs_insert on public.saved_game_configs
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy saved_configs_update on public.saved_game_configs
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy saved_configs_delete on public.saved_game_configs
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Realtime : lecture (broadcast & présence) et écriture (présence uniquement).
create policy realtime_read_authorized_topics on realtime.messages
  for select to authenticated
  using (private.can_access_topic((select realtime.topic()), extension, false));

create policy realtime_write_presence on realtime.messages
  for insert to authenticated
  with check (private.can_access_topic((select realtime.topic()), extension, true));

-- -----------------------------------------------------------------------------
-- Privilèges : on retire tout puis on accorde le strict nécessaire.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated, public;

grant select on public.profiles, public.rooms, public.room_members, public.room_bans, public.abilities,
                public.player_states, public.game_events, public.ability_usage, public.radar_pulses,
                public.map_effects, public.game_statistics
  to authenticated;
grant select, insert, update, delete on public.saved_game_configs to authenticated;

-- games : les colonnes techniques (séquences, visibilité) ne sont pas lisibles.
grant select (id, room_id, mode, phase, config, map, seed, created_by, created_at, started_at, running_at,
              phase_started_at, phase_ends_at, paused_at, paused_from, paused_remaining_ms, next_radar_at,
              radar_pulse_count, ended_at, winner, end_reason, updated_at)
  on public.games to authenticated;

-- Fonctions : aucune exécution anonyme ; RPC publiques réservées aux connectés.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function
  public.update_my_profile(text, text),
  public.create_room(text, jsonb, integer, boolean),
  public.join_room(text),
  public.leave_room(uuid),
  public.kick_member(uuid, uuid, boolean),
  public.set_member_team(uuid, uuid, text),
  public.choose_team(uuid, text),
  public.auto_assign_teams(uuid),
  public.update_room_settings(uuid, text, jsonb, integer, boolean),
  public.transfer_host(uuid, uuid),
  public.set_ready(uuid, boolean),
  public.room_heartbeat(uuid),
  public.get_room_state(uuid),
  public.get_my_rooms(),
  public.start_game(uuid),
  public.game_tick(uuid),
  public.heartbeat(uuid),
  public.server_time(),
  public.move(uuid, jsonb),
  public.attempt_capture(uuid),
  public.radar_activate(uuid),
  public.use_ability(uuid, text, jsonb),
  public.pause_game(uuid),
  public.resume_game(uuid),
  public.abort_game(uuid),
  public.leave_game(uuid),
  public.return_to_lobby(uuid),
  public.get_game_view(uuid),
  public.get_leaderboard(uuid),
  public.get_usage_stats(),
  public.admin_cleanup()
  to authenticated;

-- Helpers évalués dans les politiques RLS (rôle authenticated).
grant execute on function
  private.is_room_member(uuid, uuid),
  private.my_team(uuid),
  private.is_participant(uuid),
  private.game_finished(uuid),
  private.is_room_host(uuid),
  private.can_see_game(uuid),
  private.can_access_topic(text, text, boolean)
  to authenticated;

-- Les fonctions créées plus tard ne doivent pas être exécutables par défaut.
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema private revoke execute on functions from public, anon;
