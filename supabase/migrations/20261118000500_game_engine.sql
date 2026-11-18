-- =============================================================================
-- 0500 — Moteur de partie (autorité serveur).
--
-- Principes :
--  * Chaque action verrouille la ligne `games` (FOR UPDATE) : toutes les
--    actions d'une même partie sont sérialisées -> aucun état incohérent,
--    aucune double capture, aucune double impulsion radar.
--  * Pas de serveur permanent : les échéances (fin de préparation, impulsions
--    radar, fin de partie, abandons) sont résolues de façon paresseuse et
--    idempotente par private.tick(), appelé au début de chaque action, par
--    game_tick() (déclenché par les clients à l'échéance) et par heartbeat().
--  * Toute information est diffusée via Realtime Broadcast privé sur des flux
--    par audience. Un joueur ne reçoit jamais la position exacte d'un
--    adversaire hors de ce que les règles révèlent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Émission d'un événement de partie sur un flux
--   stream : 'all' | 'hunter' | 'fugitive' | 'p:<user_id>'
-- -----------------------------------------------------------------------------
create or replace function private.emit(p_game uuid, p_stream text, p_type text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sn bigint;
  v_audience integer;
  v_now timestamptz := private.now_();
begin
  if p_stream = 'all' then
    update public.games set seq_all = seq_all + 1 where id = p_game returning seq_all into v_sn;
    select count(*) into v_audience from public.player_states where game_id = p_game;
  elsif p_stream = 'hunter' then
    update public.games set seq_hunter = seq_hunter + 1 where id = p_game returning seq_hunter into v_sn;
    select count(*) into v_audience from public.player_states where game_id = p_game and team = 'hunter';
  elsif p_stream = 'fugitive' then
    update public.games set seq_fugitive = seq_fugitive + 1 where id = p_game returning seq_fugitive into v_sn;
    select count(*) into v_audience from public.player_states where game_id = p_game and team = 'fugitive';
  elsif p_stream like 'p:%' then
    update public.player_states set seq_personal = seq_personal + 1
     where game_id = p_game and user_id = substr(p_stream, 3)::uuid
     returning seq_personal into v_sn;
    v_audience := 1;
  end if;

  if v_sn is null then
    perform private.fail('E_INTERNAL', 'unknown stream ' || p_stream);
  end if;

  insert into public.game_events (game_id, stream, sn, type, payload, created_at)
  values (p_game, p_stream, v_sn, p_type, p_payload, v_now);

  perform realtime.send(
    jsonb_build_object('s', p_stream, 'sn', v_sn, 't', p_type, 'd', p_payload, 'at', private.ms(v_now)),
    'ev', 'game:' || p_game::text || ':' || p_stream, true);
  perform private.count_usage(0, 1, v_audience);
  return v_sn;
end;
$$;

create or replace function private.enemy_of(p_team text)
returns text
language sql
immutable
set search_path = ''
as $$ select case p_team when 'hunter' then 'fugitive' else 'hunter' end $$;

-- -----------------------------------------------------------------------------
-- Pas disponibles (régénération continue, plafonnée)
-- -----------------------------------------------------------------------------
create or replace function private.available_steps(p_ps public.player_states, p_cfg jsonb, p_now timestamptz)
returns table (steps integer, steps_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_max integer := (p_cfg ->> 'max_steps')::integer;
  v_regen integer := (p_cfg ->> 'step_regen_ms')::integer;
  v_elapsed bigint := greatest(0, private.ms(p_now) - private.ms(p_ps.steps_at));
  v_gained integer;
begin
  if p_ps.boost_until is not null and p_ps.boost_until > p_now then
    v_regen := greatest(250, v_regen / 2);
  end if;
  v_gained := (v_elapsed / v_regen)::integer;
  if p_ps.steps + v_gained >= v_max then
    return query select v_max, p_now;
  else
    return query select p_ps.steps + v_gained, p_ps.steps_at + make_interval(secs => (v_gained::bigint * v_regen) / 1000.0);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Visibilité (brouillard de guerre)
-- Une équipe voit un adversaire actif s'il est dans le rayon de vision d'au
-- moins un coéquipier actif et qu'il n'est pas en mode Fantôme.
-- Pendant la préparation, les Chasseurs ne voient rien.
-- -----------------------------------------------------------------------------
create or replace function private.compute_vis(p_game uuid, p_team text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_radius integer;
begin
  select * into v_g from public.games where id = p_game;
  if v_g.phase = 'preparation' and p_team = 'hunter' then
    return '[]'::jsonb;
  end if;
  if v_g.phase = 'paused' and v_g.paused_from = 'preparation' and p_team = 'hunter' then
    return '[]'::jsonb;
  end if;
  v_radius := (v_g.config ->> ('vision_' || p_team))::integer;

  return coalesce((
    select jsonb_agg(jsonb_build_object('u', e.user_id, 'x', e.x, 'y', e.y) order by e.user_id)
      from public.player_states e
     where e.game_id = p_game
       and e.team <> p_team
       and e.status = 'active'
       and (e.ghost_until is null or e.ghost_until <= v_now)
       and exists (
         select 1 from public.player_states a
          where a.game_id = p_game and a.team = p_team and a.status = 'active'
            and private.in_radius(e.x - a.x, e.y - a.y, v_radius))
  ), '[]'::jsonb);
end;
$$;

-- Recalcule la visibilité des deux équipes et diffuse uniquement les changements.
create or replace function private.refresh_vis(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_h jsonb := private.compute_vis(p_game, 'hunter');
  v_f jsonb := private.compute_vis(p_game, 'fugitive');
begin
  select * into v_g from public.games where id = p_game;
  if v_h is distinct from v_g.vis_hunter then
    update public.games set vis_hunter = v_h where id = p_game;
    perform private.emit(p_game, 'hunter', 'vis', jsonb_build_object('enemies', v_h));
  end if;
  if v_f is distinct from v_g.vis_fugitive then
    update public.games set vis_fugitive = v_f where id = p_game;
    perform private.emit(p_game, 'fugitive', 'vis', jsonb_build_object('enemies', v_f));
  end if;
end;
$$;

create or replace function private.phase_payload(p_game uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'phase', g.phase,
    'phase_started_at', private.ms(g.phase_started_at),
    'phase_ends_at', case when g.phase_ends_at is null then null else private.ms(g.phase_ends_at) end,
    'paused_from', g.paused_from,
    'paused_remaining_ms', g.paused_remaining_ms,
    'next_radar_at', case when g.next_radar_at is null then null else private.ms(g.next_radar_at) end,
    'running_at', case when g.running_at is null then null else private.ms(g.running_at) end)
  from public.games g where g.id = p_game
$$;

-- -----------------------------------------------------------------------------
-- Démarrage d'une partie (hôte uniquement)
-- -----------------------------------------------------------------------------
create or replace function public.start_game(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype := private.lock_room_as_host(p_room);
  v_now timestamptz := private.now_();
  v_cfg jsonb;
  v_seed bigint := floor(random() * 2147483647)::bigint;
  v_map jsonb;
  v_game_id uuid;
  v_n integer; v_nh integer; v_nf integer; v_unassigned integer;
  v_w integer; v_h integer;
  v_corner integer;
  v_cx integer; v_cy integer;
  v_bx integer; v_by integer;
  v_prep integer;
begin
  perform private.rate_limit('start_game', 5, 60000);
  if v_room.status <> 'lobby' then perform private.fail('E_NOT_IN_LOBBY'); end if;

  select count(*), count(*) filter (where team = 'hunter'), count(*) filter (where team = 'fugitive'),
         count(*) filter (where team is null)
    into v_n, v_nh, v_nf, v_unassigned
    from public.room_members where room_id = p_room;
  if v_n < 2 then perform private.fail('E_NOT_ENOUGH_PLAYERS'); end if;
  if v_unassigned > 0 then perform private.fail('E_TEAMS_INCOMPLETE'); end if;
  if v_nh = 0 or v_nf = 0 then perform private.fail('E_TEAMS_UNBALANCED'); end if;

  v_cfg := private.normalize_config(v_room.config);
  v_map := private.generate_map(v_cfg ->> 'map_size', (v_cfg ->> 'obstacle_density')::numeric,
                                (v_cfg ->> 'forbidden_zones')::boolean, v_seed);
  v_w := (v_map ->> 'w')::integer;
  v_h := (v_map ->> 'h')::integer;
  v_prep := (v_cfg ->> 'prep_s')::integer;

  insert into public.games (room_id, mode, phase, config, map, seed, created_by, started_at,
                            phase_started_at, phase_ends_at, running_at, next_radar_at)
  values (p_room, v_cfg ->> 'mode',
          case when v_prep > 0 then 'preparation' else 'running' end,
          v_cfg, v_map, v_seed, auth.uid(), v_now, v_now,
          v_now + make_interval(secs => case when v_prep > 0 then v_prep else (v_cfg ->> 'duration_s')::integer end),
          case when v_prep > 0 then null else v_now end,
          case when v_prep = 0 and (v_cfg -> 'radar' ->> 'enabled')::boolean and v_cfg -> 'radar' ->> 'mode' = 'auto'
               then v_now + make_interval(secs => (v_cfg -> 'radar' ->> 'interval_s')::integer) end)
  returning id into v_game_id;

  -- Base des Chasseurs : près d'un coin tiré au sort.
  v_corner := floor(random() * 4)::integer;
  v_cx := case when v_corner in (0, 3) then 1 else v_w - 2 end;
  v_cy := case when v_corner in (0, 1) then 1 else v_h - 2 end;
  select oc.x, oc.y into v_bx, v_by
    from private.open_cells(v_map) oc
   order by power(oc.x - v_cx, 2) + power(oc.y - v_cy, 2), oc.x, oc.y
   limit 1;

  -- Chasseurs : cases libres les plus proches de la base.
  insert into public.player_states (game_id, user_id, team, initial_team, x, y, steps, steps_at, last_seen_at, joined_at)
  select v_game_id, h.user_id, 'hunter', 'hunter', c.x, c.y, (v_cfg ->> 'max_steps')::integer, v_now, v_now, v_now
    from (select user_id, row_number() over (order by random()) rn
            from public.room_members where room_id = p_room and team = 'hunter') h
    join (select oc.x, oc.y, row_number() over (order by power(oc.x - v_bx, 2) + power(oc.y - v_by, 2), random()) rn
            from private.open_cells(v_map) oc) c
      on c.rn = h.rn;

  -- Fugitifs : cases libres éloignées de la base, réparties aléatoirement.
  insert into public.player_states (game_id, user_id, team, initial_team, x, y, steps, steps_at, last_seen_at, joined_at)
  select v_game_id, f.user_id, 'fugitive', 'fugitive', c.x, c.y, (v_cfg ->> 'max_steps')::integer, v_now, v_now, v_now
    from (select user_id, row_number() over (order by random()) rn
            from public.room_members where room_id = p_room and team = 'fugitive') f
    join (select oc.x, oc.y,
                 row_number() over (
                   order by (power(oc.x - v_bx, 2) + power(oc.y - v_by, 2) >= power(greatest(v_w, v_h) * 0.45, 2)) desc,
                            random()) rn
            from private.open_cells(v_map) oc) c
      on c.rn = f.rn;

  update public.rooms set status = 'playing', current_game_id = v_game_id where id = p_room;
  update public.room_members set is_ready = false where room_id = p_room;

  perform private.emit(v_game_id, 'all', 'phase_changed', private.phase_payload(v_game_id));
  perform private.refresh_vis(v_game_id);
  perform private.room_emit(p_room, 'game_started', jsonb_build_object('game_id', v_game_id));
  perform private.count_usage(1, 0, 0);

  return jsonb_build_object('game_id', v_game_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Transitions
-- -----------------------------------------------------------------------------
create or replace function private.begin_running(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := private.now_();
  v_cfg jsonb;
begin
  select config into v_cfg from public.games where id = p_game;
  update public.games
     set phase = 'running',
         running_at = v_now,
         phase_started_at = v_now,
         phase_ends_at = v_now + make_interval(secs => (v_cfg ->> 'duration_s')::integer),
         next_radar_at = case when (v_cfg -> 'radar' ->> 'enabled')::boolean and v_cfg -> 'radar' ->> 'mode' = 'auto'
                              then v_now + make_interval(secs => (v_cfg -> 'radar' ->> 'interval_s')::integer) end
   where id = p_game;
  perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
  perform private.refresh_vis(p_game);
end;
$$;

-- Fin de partie + statistiques + agrégats de profil (atomique).
create or replace function private.finish_game(p_game uuid, p_winner text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_counted boolean := p_reason <> 'aborted';
  v_final jsonb;
begin
  select * into v_g from public.games where id = p_game;
  if v_g.phase = 'finished' then return; end if;

  update public.games
     set phase = 'finished', ended_at = v_now, winner = p_winner, end_reason = p_reason,
         phase_ends_at = null, next_radar_at = null, phase_started_at = v_now
   where id = p_game
   returning * into v_g;

  insert into public.game_statistics (game_id, user_id, room_id, team, initial_team, final_status, outcome,
                                      captures, survival_seconds, distance, abilities_used, score, counted)
  select p_game, s.user_id, v_g.room_id, s.team, s.initial_team, s.status, s.outcome,
         s.captures, s.survival, s.distance, s.abilities_used,
         case
           when s.status = 'abandoned' then 0
           when s.initial_team = 'hunter' then s.captures * 100 + case when s.outcome = 'win' then 200 else 0 end
           else s.survival
                + case when s.status = 'active' and s.team = 'fugitive' then 300 else 0 end
                + s.captures * 100
                + case when s.outcome = 'win' then 100 else 0 end
         end,
         v_counted
    from (
      select ps.*,
             case when ps.initial_team = 'fugitive' and v_g.running_at is not null
                  then greatest(0, extract(epoch from (least(coalesce(ps.captured_at, v_now), v_now) - v_g.running_at)))::integer
                  else 0 end as survival,
             case when p_winner = 'draw' then 'draw'
                  when ps.status = 'abandoned' then 'loss'
                  when ps.team = p_winner then 'win'
                  else 'loss' end as outcome
        from public.player_states ps
       where ps.game_id = p_game
    ) s
  on conflict (game_id, user_id) do nothing;

  if v_counted then
    update public.profiles p
       set games_played = p.games_played + 1,
           wins = p.wins + (st.outcome = 'win')::integer,
           losses = p.losses + (st.outcome = 'loss')::integer,
           draws = p.draws + (st.outcome = 'draw')::integer,
           captures = p.captures + st.captures,
           times_captured = p.times_captured + (ps.captured_at is not null)::integer,
           survival_seconds = p.survival_seconds + st.survival_seconds,
           total_score = p.total_score + st.score
      from public.game_statistics st
      join public.player_states ps on ps.game_id = st.game_id and ps.user_id = st.user_id
     where st.game_id = p_game and p.id = st.user_id;
  end if;

  update public.rooms set status = 'results' where id = v_g.room_id and current_game_id = p_game;

  select jsonb_agg(jsonb_build_object(
           'u', ps.user_id, 'team', ps.team, 'initial_team', ps.initial_team, 'status', ps.status,
           'x', ps.x, 'y', ps.y, 'captures', ps.captures, 'score', st.score, 'outcome', st.outcome,
           'survival_seconds', st.survival_seconds) order by st.score desc)
    into v_final
    from public.player_states ps
    join public.game_statistics st on st.game_id = ps.game_id and st.user_id = ps.user_id
   where ps.game_id = p_game;

  perform private.emit(p_game, 'all', 'game_finished',
    jsonb_build_object('winner', p_winner, 'reason', p_reason, 'ended_at', private.ms(v_now), 'players', coalesce(v_final, '[]'::jsonb)));
  perform private.room_emit(v_g.room_id, 'game_finished', jsonb_build_object('game_id', p_game, 'winner', p_winner));
end;
$$;

-- Conditions de victoire (identiques pour Classique et Infection).
create or replace function private.check_victory(p_game uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase text;
  v_h integer; v_f integer; v_captured integer;
begin
  select phase into v_phase from public.games where id = p_game;
  if v_phase not in ('preparation', 'running') then return false; end if;

  select count(*) filter (where team = 'hunter' and status = 'active'),
         count(*) filter (where team = 'fugitive' and status = 'active'),
         count(*) filter (where captured_at is not null)
    into v_h, v_f, v_captured
    from public.player_states where game_id = p_game;

  if v_h = 0 and v_f = 0 then
    perform private.finish_game(p_game, 'draw', 'no_players');
  elsif v_f = 0 then
    perform private.finish_game(p_game, 'hunter', case when v_captured > 0 then 'all_captured' else 'fugitives_left' end);
  elsif v_h = 0 then
    perform private.finish_game(p_game, 'fugitive', 'hunters_left');
  else
    return false;
  end if;
  return true;
end;
$$;

create or replace function private.abandon_player(p_game uuid, p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase text;
begin
  select phase into v_phase from public.games where id = p_game for update;
  if v_phase is null or v_phase = 'finished' then return; end if;

  update public.player_states set status = 'abandoned', connected = false
   where game_id = p_game and user_id = p_user and status = 'active';
  if not found then return; end if;

  perform private.emit(p_game, 'all', 'player_status',
    jsonb_build_object('u', p_user, 'status', 'abandoned', 'reason', p_reason, 'connected', false));
  perform private.refresh_vis(p_game);
  perform private.check_victory(p_game);
end;
$$;

-- -----------------------------------------------------------------------------
-- Radar
-- -----------------------------------------------------------------------------
create or replace function private.radar_contacts(p_game uuid, p_team text, p_precision text, p_ox integer, p_oy integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_w integer; v_h integer;
  v_cols integer; v_size integer; v_zone integer;
  v_out jsonb := '[]'::jsonb;
  e record;
begin
  select * into v_g from public.games where id = p_game;
  v_w := (v_g.map ->> 'w')::integer;
  v_h := (v_g.map ->> 'h')::integer;
  v_cols := case when v_w >= 22 then 4 else 3 end;
  v_size := ceil(v_w / v_cols::numeric)::integer;
  v_zone := case when v_w >= 30 then 7 else 5 end;

  for e in
    select * from public.player_states
     where game_id = p_game and team = private.enemy_of(p_team) and status = 'active'
     order by md5(user_id::text || v_g.radar_pulse_count::text)
  loop
    if e.jam_until is not null and e.jam_until > v_now then
      v_out := v_out || jsonb_build_array(jsonb_build_object('jammed', true));
    elsif p_precision = 'direction' then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'dir', private.direction8(p_ox, p_oy, e.x, e.y),
        'band', private.distance_band(sqrt(power(e.x - p_ox, 2) + power(e.y - p_oy, 2)))));
    elsif p_precision = 'sector' then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'sx', e.x / v_size, 'sy', e.y / v_size, 'size', v_size, 'cols', v_cols));
    else
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'x0', greatest(0, least(v_w - v_zone, e.x - private.rand_int(0, v_zone - 1))),
        'y0', greatest(0, least(v_h - v_zone, e.y - private.rand_int(0, v_zone - 1))),
        'size', v_zone));
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function private.radar_pulse(p_game uuid, p_team text, p_kind text, p_by uuid, p_ox integer, p_oy integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_idx integer;
  v_precision text;
  v_contacts jsonb;
  v_expires timestamptz;
  v_payload jsonb;
begin
  update public.games set radar_pulse_count = radar_pulse_count + 1 where id = p_game
  returning * into v_g;
  v_idx := v_g.radar_pulse_count;
  v_precision := v_g.config -> 'radar' ->> 'precision';
  v_contacts := private.radar_contacts(p_game, p_team, v_precision, p_ox, p_oy);
  v_expires := v_now + make_interval(secs => (v_g.config -> 'radar' ->> 'reveal_s')::integer);

  v_payload := jsonb_build_object(
    'i', v_idx, 'kind', p_kind, 'precision', v_precision, 'contacts', v_contacts,
    'origin', jsonb_build_object('x', p_ox, 'y', p_oy), 'by', p_by,
    'at', private.ms(v_now), 'expires_at', private.ms(v_expires));

  insert into public.radar_pulses (game_id, team, pulse_index, kind, precision, triggered_by, payload, created_at, expires_at)
  values (p_game, p_team, v_idx, p_kind, v_precision, p_by, v_payload, v_now, v_expires);

  perform private.emit(p_game, p_team, 'radar', v_payload);
  -- L'équipe adverse perçoit qu'une impulsion a eu lieu (sans résultat).
  perform private.emit(p_game, private.enemy_of(p_team), 'radar_ping', jsonb_build_object('kind', p_kind, 'at', private.ms(v_now)));
  return v_payload;
end;
$$;

create or replace function private.auto_radar(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_teams text[];
  v_team text;
  v_ox integer; v_oy integer;
begin
  select * into v_g from public.games where id = p_game;
  v_teams := case v_g.config -> 'radar' ->> 'teams'
               when 'both' then array['hunter', 'fugitive']
               else array[v_g.config -> 'radar' ->> 'teams'] end;
  foreach v_team in array v_teams loop
    -- Origine : barycentre de l'équipe (joueurs actifs).
    select round(avg(x))::integer, round(avg(y))::integer into v_ox, v_oy
      from public.player_states where game_id = p_game and team = v_team and status = 'active';
    if v_ox is not null then
      perform private.radar_pulse(p_game, v_team, 'auto', null, v_ox, v_oy);
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tick : résolution paresseuse et idempotente des échéances.
-- Doit être appelé avec la ligne games verrouillée (fait ici).
-- -----------------------------------------------------------------------------
create or replace function private.tick(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_interval integer;
  r record;
begin
  select * into v_g from public.games where id = p_game for update;
  if not found then perform private.fail('E_GAME_NOT_FOUND'); end if;
  if v_g.phase in ('finished', 'paused') then return; end if;

  -- Déconnexions : plus de signe de vie depuis 45 s -> déconnecté.
  for r in
    update public.player_states set connected = false
     where game_id = p_game and status = 'active' and connected and last_seen_at < v_now - interval '45 seconds'
     returning user_id
  loop
    perform private.emit(p_game, 'all', 'player_status',
      jsonb_build_object('u', r.user_id, 'status', 'active', 'connected', false));
  end loop;

  -- Abandons : au-delà du délai de grâce configuré par l'hôte.
  for r in
    select user_id from public.player_states
     where game_id = p_game and status = 'active'
       and last_seen_at < v_now - make_interval(secs => (v_g.config ->> 'disconnect_grace_s')::integer)
  loop
    perform private.abandon_player(p_game, r.user_id, 'timeout');
  end loop;

  select * into v_g from public.games where id = p_game;
  if v_g.phase = 'finished' then return; end if;

  if v_g.phase = 'preparation' and v_now >= v_g.phase_ends_at then
    perform private.begin_running(p_game);
    select * into v_g from public.games where id = p_game;
  end if;

  if v_g.phase = 'running' then
    if v_now >= v_g.phase_ends_at then
      perform private.finish_game(p_game,
        case when exists (select 1 from public.player_states where game_id = p_game and team = 'fugitive' and status = 'active')
             then 'fugitive' else 'hunter' end,
        'time_up');
      return;
    end if;

    -- Impulsion radar automatique (une seule même si plusieurs échéances ont été manquées).
    if v_g.next_radar_at is not null and v_now >= v_g.next_radar_at then
      v_interval := (v_g.config -> 'radar' ->> 'interval_s')::integer;
      update public.games
         set next_radar_at = next_radar_at + make_interval(secs =>
               v_interval * (floor(extract(epoch from (v_now - next_radar_at)) / v_interval) + 1))
       where id = p_game;
      perform private.auto_radar(p_game);
      perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
    end if;

    -- Expiration des effets de carte.
    for r in delete from public.map_effects where game_id = p_game and expires_at <= v_now returning id, x, y loop
      perform private.emit(p_game, 'all', 'map_effect_removed', jsonb_build_object('id', r.id, 'x', r.x, 'y', r.y));
    end loop;

    -- Fin d'un Fantôme, etc.
    perform private.refresh_vis(p_game);
    perform private.check_victory(p_game);
  end if;
end;
$$;

create or replace function private.require_participant(p_game uuid)
returns public.player_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ps public.player_states%rowtype;
begin
  if auth.uid() is null then perform private.fail('E_NOT_AUTHENTICATED'); end if;
  select * into v_ps from public.player_states where game_id = p_game and user_id = auth.uid();
  if not found then perform private.fail('E_NOT_PARTICIPANT'); end if;
  return v_ps;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : tick et heartbeat
-- -----------------------------------------------------------------------------
create or replace function public.game_tick(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('tick', 30, 10000);
  perform private.tick(p_game);
  perform private.count_usage(1, 0, 0);
  return private.phase_payload(p_game) || jsonb_build_object('server_now', private.ms(private.now_()));
end;
$$;

create or replace function public.heartbeat(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ps public.player_states%rowtype := private.require_participant(p_game);
  v_now timestamptz := private.now_();
  v_phase text;
begin
  perform private.rate_limit('heartbeat', 12, 60000);
  select phase into v_phase from public.games where id = p_game for update;

  update public.player_states set last_seen_at = v_now, connected = true
   where game_id = p_game and user_id = v_ps.user_id;
  update public.room_members set last_seen_at = v_now
   where user_id = v_ps.user_id and room_id = (select room_id from public.games where id = p_game);

  if v_phase <> 'finished' and v_ps.status = 'active' and not v_ps.connected then
    perform private.emit(p_game, 'all', 'player_status',
      jsonb_build_object('u', v_ps.user_id, 'status', 'active', 'connected', true));
  end if;

  perform private.tick(p_game);
  perform private.count_usage(1, 0, 0);
  return private.phase_payload(p_game) || jsonb_build_object('server_now', private.ms(private.now_()));
end;
$$;

-- Référence temporelle serveur pour la synchronisation d'horloge client.
create or replace function public.server_time()
returns bigint
language sql
volatile
set search_path = ''
as $$ select private.ms(clock_timestamp()) $$;

-- -----------------------------------------------------------------------------
-- RPC : déplacement
--   p_path : tableau de cases [[x,y], ...] adjacentes (4 directions),
--            de longueur <= pas disponibles.
-- -----------------------------------------------------------------------------
create or replace function public.move(p_game uuid, p_path jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := private.now_();
  v_g public.games%rowtype;
  v_ps public.player_states%rowtype;
  v_len integer;
  v_avail integer;
  v_avail_at timestamptz;
  v_cx integer; v_cy integer; v_nx integer; v_ny integer;
  v_step jsonb;
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('move', 6, 1000);
  perform private.tick(p_game);

  select * into v_g from public.games where id = p_game for update;
  select * into v_ps from public.player_states where game_id = p_game and user_id = auth.uid() for update;

  if v_ps.status <> 'active' then perform private.fail('E_NOT_ACTIVE'); end if;
  if not (v_g.phase = 'running' or (v_g.phase = 'preparation' and v_ps.team = 'fugitive')) then
    perform private.fail('E_CANNOT_MOVE_NOW');
  end if;

  if p_path is null or jsonb_typeof(p_path) <> 'array' then perform private.fail('E_INVALID_PATH'); end if;
  v_len := jsonb_array_length(p_path);
  if v_len < 1 or v_len > 10 then perform private.fail('E_INVALID_PATH'); end if;

  select s.steps, s.steps_at into v_avail, v_avail_at from private.available_steps(v_ps, v_g.config, v_now) s;
  if v_len > v_avail then perform private.fail('E_NOT_ENOUGH_STEPS', v_avail::text); end if;

  v_cx := v_ps.x; v_cy := v_ps.y;
  for v_step in select value from jsonb_array_elements(p_path) loop
    if jsonb_typeof(v_step) <> 'array' or jsonb_array_length(v_step) <> 2
       or jsonb_typeof(v_step -> 0) <> 'number' or jsonb_typeof(v_step -> 1) <> 'number' then
      perform private.fail('E_INVALID_PATH');
    end if;
    v_nx := (v_step ->> 0)::integer;
    v_ny := (v_step ->> 1)::integer;
    if abs(v_nx - v_cx) + abs(v_ny - v_cy) <> 1 then perform private.fail('E_INVALID_PATH'); end if;
    if private.cell(v_g.map, v_nx, v_ny) <> '.' then perform private.fail('E_BLOCKED'); end if;
    if exists (select 1 from public.map_effects
                where game_id = p_game and kind = 'blocked' and x = v_nx and y = v_ny and expires_at > v_now) then
      perform private.fail('E_BLOCKED');
    end if;
    v_cx := v_nx; v_cy := v_ny;
  end loop;

  update public.player_states
     set x = v_cx, y = v_cy,
         steps = v_avail - v_len,
         steps_at = v_avail_at,
         distance = distance + v_len,
         last_move_at = v_now,
         last_seen_at = v_now,
         connected = true
   where game_id = p_game and user_id = v_ps.user_id
   returning * into v_ps;

  perform private.emit(p_game, v_ps.team, 'move',
    jsonb_build_object('u', v_ps.user_id, 'x', v_cx, 'y', v_cy, 'p', p_path));
  perform private.refresh_vis(p_game);
  perform private.count_usage(1, 0, 0);

  return jsonb_build_object('x', v_ps.x, 'y', v_ps.y, 'steps', v_ps.steps,
                            'steps_at', private.ms(v_ps.steps_at), 'server_now', private.ms(v_now));
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : tentative de capture (Chasseurs)
-- Capture tous les Fugitifs actifs à distance de Tchebychev <= capture_range,
-- visibles ou non. Un échec déclenche aussi le temps de recharge.
-- -----------------------------------------------------------------------------
create or replace function public.attempt_capture(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := private.now_();
  v_g public.games%rowtype;
  v_ps public.player_states%rowtype;
  v_cd interval;
  v_captured uuid[] := '{}';
  f record;
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('capture', 3, 1000);
  perform private.tick(p_game);

  select * into v_g from public.games where id = p_game for update;
  select * into v_ps from public.player_states where game_id = p_game and user_id = auth.uid() for update;

  if v_g.phase <> 'running' then perform private.fail('E_CANNOT_CAPTURE_NOW'); end if;
  if v_ps.team <> 'hunter' then perform private.fail('E_WRONG_TEAM'); end if;
  if v_ps.status <> 'active' then perform private.fail('E_NOT_ACTIVE'); end if;

  v_cd := make_interval(secs => (v_g.config ->> 'capture_cooldown_s')::integer);
  if v_ps.last_capture_at is not null and v_ps.last_capture_at + v_cd > v_now then
    perform private.fail('E_COOLDOWN', private.ms(v_ps.last_capture_at + v_cd)::text);
  end if;

  update public.player_states set last_capture_at = v_now, last_seen_at = v_now, connected = true
   where game_id = p_game and user_id = v_ps.user_id;

  for f in
    select * from public.player_states
     where game_id = p_game and team = 'fugitive' and status = 'active'
       and private.cheb(x, y, v_ps.x, v_ps.y) <= (v_g.config ->> 'capture_range')::integer
     for update
  loop
    if v_g.mode = 'infection' then
      -- Mode Infection : le Fugitif rejoint les Chasseurs.
      update public.player_states
         set team = 'hunter', captured_at = v_now, captured_by = v_ps.user_id,
             ghost_until = null, jam_until = null, boost_until = null
       where game_id = p_game and user_id = f.user_id;
    else
      update public.player_states
         set status = 'captured', captured_at = v_now, captured_by = v_ps.user_id,
             ghost_until = null, jam_until = null, boost_until = null
       where game_id = p_game and user_id = f.user_id;
    end if;
    update public.player_states set captures = captures + 1 where game_id = p_game and user_id = v_ps.user_id;
    v_captured := v_captured || f.user_id;

    perform private.emit(p_game, 'all', 'capture',
      jsonb_build_object('h', v_ps.user_id, 'f', f.user_id, 'x', f.x, 'y', f.y,
                         'infected', v_g.mode = 'infection'));
    if v_g.mode = 'infection' then
      perform private.emit(p_game, 'p:' || f.user_id::text, 'team_changed', jsonb_build_object('team', 'hunter'));
    end if;
  end loop;

  if array_length(v_captured, 1) is null then
    perform private.emit(p_game, 'p:' || v_ps.user_id::text, 'capture_missed', jsonb_build_object('x', v_ps.x, 'y', v_ps.y));
  end if;

  perform private.refresh_vis(p_game);
  perform private.check_victory(p_game);
  perform private.count_usage(1, 0, 0);

  return jsonb_build_object('captured', to_jsonb(v_captured),
                            'cooldown_until', private.ms(v_now + v_cd),
                            'server_now', private.ms(v_now));
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : radar manuel
-- -----------------------------------------------------------------------------
create or replace function public.radar_activate(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := private.now_();
  v_g public.games%rowtype;
  v_ps public.player_states%rowtype;
  v_radar jsonb;
  v_state jsonb;
  v_last bigint;
  v_uses integer;
  v_payload jsonb;
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('radar', 3, 1000);
  perform private.tick(p_game);

  select * into v_g from public.games where id = p_game for update;
  select * into v_ps from public.player_states where game_id = p_game and user_id = auth.uid();
  v_radar := v_g.config -> 'radar';

  if v_g.phase <> 'running' then perform private.fail('E_PHASE'); end if;
  if v_ps.status <> 'active' then perform private.fail('E_NOT_ACTIVE'); end if;
  if not (v_radar ->> 'enabled')::boolean or v_radar ->> 'mode' <> 'manual' then
    perform private.fail('E_RADAR_UNAVAILABLE');
  end if;
  if v_radar ->> 'teams' not in ('both', v_ps.team) then perform private.fail('E_WRONG_TEAM'); end if;

  v_state := coalesce(v_g.team_state -> v_ps.team, '{}'::jsonb);
  v_last := (v_state ->> 'radar_last')::bigint;
  v_uses := coalesce((v_state ->> 'radar_uses')::integer, 0);

  if v_last is not null and v_last + (v_radar ->> 'cooldown_s')::bigint * 1000 > private.ms(v_now) then
    perform private.fail('E_COOLDOWN', (v_last + (v_radar ->> 'cooldown_s')::bigint * 1000)::text);
  end if;
  if (v_radar ->> 'max_uses')::integer > 0 and v_uses >= (v_radar ->> 'max_uses')::integer then
    perform private.fail('E_NO_USES_LEFT');
  end if;

  update public.games
     set team_state = jsonb_set(team_state, array[v_ps.team],
           jsonb_build_object('radar_last', private.ms(v_now), 'radar_uses', v_uses + 1))
   where id = p_game;

  v_payload := private.radar_pulse(p_game, v_ps.team, 'manual', v_ps.user_id, v_ps.x, v_ps.y);
  perform private.count_usage(1, 0, 0);
  return v_payload || jsonb_build_object('uses', v_uses + 1);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : capacités spéciales
-- -----------------------------------------------------------------------------
create or replace function public.use_ability(p_game uuid, p_key text, p_target jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := private.now_();
  v_g public.games%rowtype;
  v_ps public.player_states%rowtype;
  v_ab public.abilities%rowtype;
  v_cfg jsonb;
  v_dur integer; v_cd integer; v_max integer;
  v_last timestamptz;
  v_uses integer;
  v_until timestamptz;
  v_tx integer; v_ty integer;
  v_result jsonb := '{}'::jsonb;
  v_avail integer; v_avail_at timestamptz;
  v_range integer; v_radius integer;
  v_contacts jsonb;
  v_effect_id uuid;
  n record;
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('ability', 4, 1000);
  perform private.tick(p_game);

  select * into v_g from public.games where id = p_game for update;
  select * into v_ps from public.player_states where game_id = p_game and user_id = auth.uid() for update;
  select * into v_ab from public.abilities where key = p_key;

  if not found or not v_ab.enabled then perform private.fail('E_UNKNOWN_ABILITY'); end if;
  v_cfg := v_g.config -> 'abilities' -> p_key;
  if v_cfg is null or not (v_cfg ->> 'enabled')::boolean then perform private.fail('E_ABILITY_DISABLED'); end if;
  if v_g.phase <> 'running' then perform private.fail('E_PHASE'); end if;
  if v_ps.status <> 'active' then perform private.fail('E_NOT_ACTIVE'); end if;
  if v_ps.team <> v_ab.team then perform private.fail('E_WRONG_TEAM'); end if;

  v_dur := (v_cfg ->> 'duration_s')::integer;
  v_cd := (v_cfg ->> 'cooldown_s')::integer;
  v_max := (v_cfg ->> 'max_uses')::integer;

  select max(used_at), count(*) into v_last, v_uses
    from public.ability_usage where game_id = p_game and user_id = v_ps.user_id and ability_key = p_key;
  if v_last is not null and v_last + make_interval(secs => v_cd) > v_now then
    perform private.fail('E_COOLDOWN', private.ms(v_last + make_interval(secs => v_cd))::text);
  end if;
  if v_max > 0 and v_uses >= v_max then perform private.fail('E_NO_USES_LEFT'); end if;

  v_until := v_now + make_interval(secs => v_dur);

  if v_ab.targeting = 'cell' then
    if p_target is null or jsonb_typeof(p_target -> 'x') <> 'number' or jsonb_typeof(p_target -> 'y') <> 'number' then
      perform private.fail('E_TARGET_REQUIRED');
    end if;
    v_tx := (p_target ->> 'x')::integer;
    v_ty := (p_target ->> 'y')::integer;
    v_range := coalesce((v_ab.params ->> 'range')::integer, 5);
    if v_tx < 0 or v_ty < 0 or v_tx >= (v_g.map ->> 'w')::integer or v_ty >= (v_g.map ->> 'h')::integer
       or private.cheb(v_tx, v_ty, v_ps.x, v_ps.y) > v_range then
      perform private.fail('E_OUT_OF_RANGE');
    end if;
  end if;

  case p_key
    when 'ghost' then
      update public.player_states set ghost_until = v_until where game_id = p_game and user_id = v_ps.user_id;
    when 'jammer' then
      update public.player_states set jam_until = v_until where game_id = p_game and user_id = v_ps.user_id;
    when 'sprint' then
      select s.steps, s.steps_at into v_avail, v_avail_at from private.available_steps(v_ps, v_g.config, v_now) s;
      v_avail := least((v_g.config ->> 'max_steps')::integer, v_avail + coalesce((v_ab.params ->> 'bonus_steps')::integer, 2));
      update public.player_states
         set boost_until = v_until, steps = v_avail,
             steps_at = case when v_avail >= (v_g.config ->> 'max_steps')::integer then v_now else v_avail_at end
       where game_id = p_game and user_id = v_ps.user_id;
      v_result := jsonb_build_object('steps', v_avail);
    when 'scan' then
      v_radius := coalesce((v_ab.params ->> 'radius')::integer, 2);
      select coalesce(jsonb_agg(jsonb_build_object('u', f.user_id, 'x', f.x, 'y', f.y)), '[]'::jsonb)
        into v_contacts
        from public.player_states f
       where f.game_id = p_game and f.team = 'fugitive' and f.status = 'active'
         and private.in_radius(f.x - v_tx, f.y - v_ty, v_radius);
      v_result := jsonb_build_object('area', jsonb_build_object('x', v_tx, 'y', v_ty, 'r', v_radius),
                                     'contacts', v_contacts, 'expires_at', private.ms(v_until));
      perform private.emit(p_game, 'hunter', 'reveal', v_result || jsonb_build_object('by', v_ps.user_id));
      for n in select f.user_id from public.player_states f
                where f.game_id = p_game and f.team = 'fugitive' and f.status = 'active'
                  and private.in_radius(f.x - v_tx, f.y - v_ty, v_radius) loop
        perform private.emit(p_game, 'p:' || n.user_id::text, 'alert', jsonb_build_object('kind', 'scanned'));
      end loop;
    when 'tracker' then
      select f.* into n from public.player_states f
       where f.game_id = p_game and f.team = 'fugitive' and f.status = 'active'
       order by power(f.x - v_ps.x, 2) + power(f.y - v_ps.y, 2), f.user_id
       limit 1;
      if not found then
        v_result := jsonb_build_object('none', true);
      elsif n.jam_until is not null and n.jam_until > v_now then
        v_result := jsonb_build_object('jammed', true);
      else
        v_result := jsonb_build_object('dir', private.direction8(v_ps.x, v_ps.y, n.x, n.y),
                                       'band', private.distance_band(sqrt(power(n.x - v_ps.x, 2) + power(n.y - v_ps.y, 2))));
      end if;
      v_result := v_result || jsonb_build_object('origin', jsonb_build_object('x', v_ps.x, 'y', v_ps.y));
      perform private.emit(p_game, 'hunter', 'tracker', v_result || jsonb_build_object('by', v_ps.user_id));
    when 'barrier' then
      if private.cell(v_g.map, v_tx, v_ty) <> '.' then perform private.fail('E_BLOCKED'); end if;
      if exists (select 1 from public.map_effects where game_id = p_game and x = v_tx and y = v_ty and expires_at > v_now) then
        perform private.fail('E_BLOCKED');
      end if;
      insert into public.map_effects (game_id, kind, x, y, created_by, created_at, expires_at)
      values (p_game, 'blocked', v_tx, v_ty, v_ps.user_id, v_now, v_until)
      returning id into v_effect_id;
      v_result := jsonb_build_object('id', v_effect_id, 'x', v_tx, 'y', v_ty, 'expires_at', private.ms(v_until));
      perform private.emit(p_game, 'all', 'map_effect',
        jsonb_build_object('id', v_effect_id, 'kind', 'blocked', 'x', v_tx, 'y', v_ty, 'expires_at', private.ms(v_until)));
    else
      perform private.fail('E_UNKNOWN_ABILITY');
  end case;

  insert into public.ability_usage (game_id, user_id, team, ability_key, used_at, expires_at, target, result)
  values (p_game, v_ps.user_id, v_ps.team, p_key, v_now, case when v_dur > 0 then v_until end, p_target, v_result);
  update public.player_states set abilities_used = abilities_used + 1, last_seen_at = v_now, connected = true
   where game_id = p_game and user_id = v_ps.user_id;

  perform private.emit(p_game, v_ps.team, 'ability',
    jsonb_build_object('u', v_ps.user_id, 'key', p_key, 'until', case when v_dur > 0 then private.ms(v_until) end));

  perform private.refresh_vis(p_game);
  perform private.count_usage(1, 0, 0);

  return jsonb_build_object('key', p_key, 'used_at', private.ms(v_now),
                            'until', case when v_dur > 0 then private.ms(v_until) end,
                            'cooldown_until', private.ms(v_now + make_interval(secs => v_cd)),
                            'uses', v_uses + 1, 'result', v_result, 'server_now', private.ms(v_now));
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : contrôle de partie par l'hôte (pause / reprise / interruption)
-- -----------------------------------------------------------------------------
create or replace function private.lock_game_as_host(p_game uuid)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
begin
  select * into v_g from public.games where id = p_game for update;
  if not found then perform private.fail('E_GAME_NOT_FOUND'); end if;
  if not exists (select 1 from public.rooms where id = v_g.room_id and host_id = auth.uid()) then
    perform private.fail('E_NOT_HOST');
  end if;
  return v_g;
end;
$$;

create or replace function public.pause_game(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype := private.lock_game_as_host(p_game);
  v_now timestamptz := private.now_();
begin
  perform private.tick(p_game);
  select * into v_g from public.games where id = p_game;
  if v_g.phase not in ('preparation', 'running') then perform private.fail('E_INVALID_TRANSITION'); end if;

  update public.games
     set paused_from = phase,
         phase = 'paused',
         paused_at = v_now,
         paused_remaining_ms = greatest(0, private.ms(phase_ends_at) - private.ms(v_now))::integer,
         radar_remaining_ms = case when next_radar_at is null then null
                                   else greatest(0, private.ms(next_radar_at) - private.ms(v_now))::integer end,
         phase_ends_at = null,
         next_radar_at = null,
         phase_started_at = v_now
   where id = p_game;
  perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
  return private.phase_payload(p_game);
end;
$$;

create or replace function public.resume_game(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype := private.lock_game_as_host(p_game);
  v_now timestamptz := private.now_();
  v_delta interval;
begin
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

  -- Les effets, temps de recharge et régénération sont gelés pendant la pause.
  update public.player_states
     set ghost_until = case when ghost_until > v_g.paused_at then ghost_until + v_delta else ghost_until end,
         jam_until = case when jam_until > v_g.paused_at then jam_until + v_delta else jam_until end,
         boost_until = case when boost_until > v_g.paused_at then boost_until + v_delta else boost_until end,
         last_capture_at = last_capture_at + v_delta,
         steps_at = steps_at + v_delta,
         last_seen_at = greatest(last_seen_at, v_now - interval '30 seconds')
   where game_id = p_game;
  update public.ability_usage set used_at = used_at + v_delta, expires_at = expires_at + v_delta where game_id = p_game;
  update public.map_effects set expires_at = expires_at + v_delta where game_id = p_game;
  update public.radar_pulses set expires_at = expires_at + v_delta where game_id = p_game and expires_at > v_g.paused_at;

  perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
  return private.phase_payload(p_game);
end;
$$;

create or replace function public.abort_game(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype := private.lock_game_as_host(p_game);
begin
  if v_g.phase = 'finished' then perform private.fail('E_INVALID_TRANSITION'); end if;
  perform private.finish_game(p_game, 'draw', 'aborted');
end;
$$;

create or replace function public.leave_game(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_participant(p_game);
  perform private.abandon_player(p_game, auth.uid(), 'left');
end;
$$;

create or replace function public.return_to_lobby(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype := private.lock_room_as_host(p_room);
begin
  if v_room.status = 'playing' and exists (
       select 1 from public.games where id = v_room.current_game_id and phase <> 'finished') then
    perform private.fail('E_GAME_IN_PROGRESS');
  end if;
  update public.rooms set status = 'lobby', current_game_id = null where id = p_room;
  perform private.room_emit(p_room, 'returned_to_lobby');
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : vue complète d'une partie pour le joueur (resynchronisation).
-- Ne contient QUE les informations autorisées pour son équipe.
-- -----------------------------------------------------------------------------
create or replace function public.get_game_view(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.player_states%rowtype := private.require_participant(p_game);
  v_now timestamptz := private.now_();
  v_g public.games%rowtype;
  v_room public.rooms%rowtype;
  v_finished boolean;
  v_steps integer; v_steps_at timestamptz;
begin
  perform private.rate_limit('game_view', 20, 10000);
  perform private.tick(p_game);
  select * into v_g from public.games where id = p_game;
  select * into v_me from public.player_states where game_id = p_game and user_id = v_me.user_id;
  select * into v_room from public.rooms where id = v_g.room_id;
  v_finished := v_g.phase = 'finished';
  select s.steps, s.steps_at into v_steps, v_steps_at from private.available_steps(v_me, v_g.config, v_now) s;
  perform private.count_usage(1, 0, 0);

  return jsonb_build_object(
    'server_now', private.ms(v_now),
    'game', jsonb_build_object(
      'id', v_g.id, 'room_id', v_g.room_id, 'mode', v_g.mode, 'phase', v_g.phase, 'config', v_g.config, 'map', v_g.map,
      'started_at', private.ms(v_g.started_at),
      'running_at', case when v_g.running_at is null then null else private.ms(v_g.running_at) end,
      'phase_started_at', private.ms(v_g.phase_started_at),
      'phase_ends_at', case when v_g.phase_ends_at is null then null else private.ms(v_g.phase_ends_at) end,
      'paused_from', v_g.paused_from, 'paused_remaining_ms', v_g.paused_remaining_ms,
      'next_radar_at', case when v_g.next_radar_at is null then null else private.ms(v_g.next_radar_at) end,
      'ended_at', case when v_g.ended_at is null then null else private.ms(v_g.ended_at) end,
      'winner', v_g.winner, 'end_reason', v_g.end_reason,
      'radar_state', coalesce(v_g.team_state -> v_me.team, '{}'::jsonb)),
    'room', jsonb_build_object('id', v_room.id, 'code', v_room.code, 'name', v_room.name, 'host_id', v_room.host_id),
    'me', jsonb_build_object(
      'u', v_me.user_id, 'team', v_me.team, 'initial_team', v_me.initial_team, 'status', v_me.status,
      'x', v_me.x, 'y', v_me.y, 'steps', v_steps, 'steps_at', private.ms(v_steps_at),
      'ghost_until', private.ms(v_me.ghost_until), 'jam_until', private.ms(v_me.jam_until),
      'boost_until', private.ms(v_me.boost_until),
      'last_capture_at', private.ms(v_me.last_capture_at), 'captures', v_me.captures),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'u', ps.user_id, 'username', p.username, 'avatar', p.avatar, 'team', ps.team,
               'status', ps.status, 'connected', ps.connected, 'captures', ps.captures)
             order by ps.team, p.username), '[]'::jsonb)
        from public.player_states ps join public.profiles p on p.id = ps.user_id
       where ps.game_id = p_game),
    'allies', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'u', ps.user_id, 'x', ps.x, 'y', ps.y, 'team', ps.team, 'status', ps.status,
               'ghost_until', private.ms(ps.ghost_until), 'boost_until', private.ms(ps.boost_until),
               'jam_until', private.ms(ps.jam_until))), '[]'::jsonb)
        from public.player_states ps
       where ps.game_id = p_game and (v_finished or ps.team = v_me.team)),
    'visible', case when v_finished then '[]'::jsonb else private.compute_vis(p_game, v_me.team) end,
    'effects', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'x', e.x, 'y', e.y,
                                                   'expires_at', private.ms(e.expires_at))), '[]'::jsonb)
        from public.map_effects e where e.game_id = p_game and e.expires_at > v_now),
    'cooldowns', (
      select coalesce(jsonb_object_agg(k.ability_key, jsonb_build_object(
               'last_used_at', private.ms(k.last_used), 'uses', k.uses, 'until', private.ms(k.until))), '{}'::jsonb)
        from (select ability_key, max(used_at) last_used, count(*) uses, max(expires_at) until
                from public.ability_usage where game_id = p_game and user_id = v_me.user_id
               group by ability_key) k),
    'radar', (
      select rp.payload from public.radar_pulses rp
       where rp.game_id = p_game and rp.team = v_me.team and rp.expires_at > v_now
       order by rp.pulse_index desc limit 1),
    'reveals', (
      select coalesce(jsonb_agg(au.result || jsonb_build_object('by', au.user_id)), '[]'::jsonb)
        from public.ability_usage au
       where au.game_id = p_game and au.team = v_me.team and au.ability_key = 'scan' and au.expires_at > v_now),
    'streams', jsonb_build_object(
      'all', v_g.seq_all,
      'team', case v_me.team when 'hunter' then v_g.seq_hunter else v_g.seq_fugitive end,
      'p', v_me.seq_personal),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object('s', ev.stream, 'sn', ev.sn, 't', ev.type, 'd', ev.payload,
                                                   'at', private.ms(ev.created_at)) order by ev.id), '[]'::jsonb)
        from (select * from public.game_events ev
               where ev.game_id = p_game
                 and ev.type not in ('move', 'vis')
                 and (ev.stream = 'all' or ev.stream = v_me.team or ev.stream = 'p:' || v_me.user_id::text)
               order by ev.id desc limit 40) ev),
    'final', case when v_finished then (
      select jsonb_agg(jsonb_build_object('u', st.user_id, 'team', st.team, 'initial_team', st.initial_team,
                                          'status', st.final_status, 'outcome', st.outcome, 'score', st.score,
                                          'captures', st.captures, 'survival_seconds', st.survival_seconds,
                                          'distance', st.distance) order by st.score desc)
        from public.game_statistics st where st.game_id = p_game) end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Classement privé et statistiques
-- -----------------------------------------------------------------------------
create or replace function public.get_leaderboard(p_room uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_room is not null and not private.is_room_member(p_room, auth.uid()) then
    perform private.fail('E_NOT_MEMBER');
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb)
      from (
        select p.id, p.username, p.avatar, p.games_played, p.wins, p.losses, p.draws, p.captures,
               p.survival_seconds, p.total_score,
               case when p.games_played > 0 then round(100.0 * p.wins / p.games_played) else 0 end as win_rate
          from public.profiles p
         where p.username is not null and p.games_played > 0
           and (p_room is null or exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = p.id))
         order by p.wins desc, p.total_score desc, p.username
         limit 100
      ) t), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Administration : consommation et nettoyage
-- -----------------------------------------------------------------------------
create or replace function public.get_usage_stats()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    perform private.fail('E_FORBIDDEN');
  end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'profiles', (select count(*) from public.profiles),
    'rooms_open', (select count(*) from public.rooms where status <> 'closed'),
    'games_total', (select count(*) from public.games),
    'games_live', (select count(*) from public.games where phase <> 'finished'),
    'events_total', (select count(*) from public.game_events),
    'daily', coalesce((select jsonb_agg(row_to_json(u)::jsonb order by u.day desc)
                         from (select * from private.usage_daily order by day desc limit 31) u), '[]'::jsonb),
    'month_delivered_estimate', coalesce((select sum(delivered_estimate) from private.usage_daily
                                           where day >= date_trunc('month', private.now_())::date), 0)
  );
end;
$$;

create or replace function private.cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events integer; v_rooms integer; v_games integer;
begin
  -- Parties abandonnées sans activité depuis 6 h : clôture.
  with stale as (
    select id from public.games where phase <> 'finished' and updated_at < private.now_() - interval '6 hours'
  )
  update public.games g set phase = 'finished', winner = 'draw', end_reason = 'aborted', ended_at = private.now_()
    from stale where g.id = stale.id;
  get diagnostics v_games = row_count;

  -- Journaux de déplacement des parties terminées depuis plus de 30 jours.
  delete from public.game_events e using public.games g
   where e.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '30 days';
  get diagnostics v_events = row_count;

  -- Salons inactifs depuis 7 jours.
  update public.rooms set status = 'closed'
   where status <> 'closed' and last_activity_at < private.now_() - interval '7 days';
  get diagnostics v_rooms = row_count;

  delete from private.rate_limits where window_start < private.now_() - interval '1 day';
  return jsonb_build_object('games_closed', v_games, 'events_deleted', v_events, 'rooms_closed', v_rooms);
end;
$$;

create or replace function public.admin_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    perform private.fail('E_FORBIDDEN');
  end if;
  return private.cleanup();
end;
$$;
