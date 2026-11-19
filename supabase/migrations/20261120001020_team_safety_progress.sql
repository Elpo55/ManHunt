-- =============================================================================
-- 1020 — Communication d'équipe, sécurité (SOS, santé des appareils),
--         spectateurs, replay 24 h, succès et statistiques (v0.4.0)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Repères d'équipe (durée de vie limitée, jamais visibles de l'adversaire)
-- -----------------------------------------------------------------------------
create table if not exists public.team_markers (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games (id) on delete cascade,
  team       text not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  lat        double precision not null,
  lng        double precision not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  removed_at timestamptz,
  constraint team_markers_kind_check check (kind in ('enemy', 'danger', 'meet', 'objective', 'info')),
  constraint team_markers_team_check check (team in ('hunter', 'fugitive'))
);
create index if not exists team_markers_game_idx on public.team_markers (game_id, team, expires_at);
alter table public.team_markers enable row level security;
revoke all on public.team_markers from anon, authenticated, public;

create or replace function private.require_active_player(p_game uuid)
returns public.player_states language plpgsql security definer set search_path = '' as $$
declare
  v_ps public.player_states%rowtype := private.require_participant(p_game);
  v_phase text;
begin
  select phase into v_phase from public.games where id = p_game;
  if v_phase = 'finished' then perform private.fail('E_GAME_FINISHED'); end if;
  -- Spectateurs (capturés, partis) : aucune communication vers une équipe en jeu.
  if v_ps.status <> 'active' then perform private.fail('E_SPECTATOR'); end if;
  return v_ps;
end;
$$;

-- -----------------------------------------------------------------------------
-- Messages rapides prédéfinis (pas de texte libre)
-- -----------------------------------------------------------------------------
create or replace function public.team_message(p_game uuid, p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ps public.player_states%rowtype := private.require_active_player(p_game);
begin
  if p_code not in ('seen', 'help', 'north', 'south', 'east', 'west', 'moving', 'danger', 'marked', 'regroup', 'safe', 'hiding')
  then perform private.fail('E_INVALID_MESSAGE'); end if;
  perform private.rate_limit('team_msg', 1, 2500);
  perform private.rate_limit('team_msg_min', 15, 60000);
  perform private.emit(p_game, v_ps.team, 'team_msg', jsonb_build_object('u', v_ps.user_id, 'code', p_code, 'at', private.ms(private.now_())));
end;
$$;

create or replace function public.place_marker(p_game uuid, p_kind text, p_lat double precision, p_lng double precision, p_ttl_s integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ps public.player_states%rowtype := private.require_active_player(p_game);
  v_cfg jsonb;
  v_now timestamptz := private.now_();
  v_id uuid;
  v_exp timestamptz;
  v_old uuid;
begin
  perform private.rate_limit('marker', 6, 60000);
  if p_kind not in ('enemy', 'danger', 'meet', 'objective', 'info') then perform private.fail('E_INVALID_MARKER'); end if;
  if p_lat is null or p_lng is null or p_lat not between -85 and 85 or p_lng not between -180 and 180 then perform private.fail('E_INVALID_POSITION'); end if;
  select config into v_cfg from public.games where id = p_game;
  -- Repère dans le cadre de la zone (rayon × 1,5) : pas d'usage hors partie.
  if private.dist_m((v_cfg -> 'zone' ->> 'lat')::double precision, (v_cfg -> 'zone' ->> 'lng')::double precision, p_lat, p_lng)
     > (v_cfg -> 'zone' ->> 'radius_m')::double precision * 1.5 then perform private.fail('E_MARKER_OUTSIDE'); end if;
  v_exp := v_now + make_interval(secs => greatest(30, least(coalesce(p_ttl_s, 120), 600)));
  -- Au plus 3 repères actifs par joueur : le plus ancien est retiré.
  select id into v_old from public.team_markers
   where game_id = p_game and user_id = v_ps.user_id and removed_at is null and expires_at > v_now
   order by created_at offset 2 limit 1;
  if v_old is not null then
    update public.team_markers set removed_at = v_now
     where game_id = p_game and user_id = v_ps.user_id and removed_at is null and expires_at > v_now
       and created_at <= (select created_at from public.team_markers where id = v_old);
  end if;
  insert into public.team_markers (game_id, team, user_id, kind, lat, lng, created_at, expires_at)
  values (p_game, v_ps.team, v_ps.user_id, p_kind, round(p_lat::numeric, 5), round(p_lng::numeric, 5), v_now, v_exp)
  returning id into v_id;
  perform private.emit(p_game, v_ps.team, 'marker', jsonb_build_object('id', v_id, 'u', v_ps.user_id, 'kind', p_kind,
            'lat', round(p_lat::numeric, 5), 'lng', round(p_lng::numeric, 5), 'expires_at', private.ms(v_exp)));
  return jsonb_build_object('id', v_id, 'expires_at', private.ms(v_exp));
end;
$$;

create or replace function public.remove_marker(p_game uuid, p_marker uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ps public.player_states%rowtype := private.require_active_player(p_game);
begin
  update public.team_markers set removed_at = private.now_()
   where id = p_marker and game_id = p_game and team = v_ps.team and removed_at is null;
  if not found then perform private.fail('E_NOT_FOUND'); end if;
  perform private.emit(p_game, v_ps.team, 'marker_removed', jsonb_build_object('id', p_marker));
end;
$$;

-- -----------------------------------------------------------------------------
-- SOS : pause immédiate, information de tous, reprise par décision explicite
-- -----------------------------------------------------------------------------
create or replace function public.sos_raise(p_game uuid, p_message text, p_share_location boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ps public.player_states%rowtype := private.require_participant(p_game);
  v_g public.games%rowtype;
  v_pos private.player_positions%rowtype;
  v_msg text := left(btrim(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]', ' ', 'g')), 200);
  v_sos jsonb;
begin
  perform private.rate_limit('sos', 3, 600000);
  select * into v_g from public.games where id = p_game for update;
  if v_g.phase = 'finished' then perform private.fail('E_GAME_FINISHED'); end if;
  if v_g.phase in ('preparation', 'running') then perform private.do_pause(p_game); end if;
  -- Position exacte transmise uniquement si le joueur l'accepte explicitement.
  if p_share_location then v_pos := private.fresh_position(p_game, v_ps.user_id, 120); end if;
  v_sos := jsonb_build_object('u', v_ps.user_id, 'username', (select username from public.profiles where id = v_ps.user_id),
             'message', v_msg, 'at', private.ms(private.now_()),
             'lat', case when v_pos.game_id is not null then round(v_pos.lat::numeric, 5) end,
             'lng', case when v_pos.game_id is not null then round(v_pos.lng::numeric, 5) end,
             'acc', case when v_pos.game_id is not null then round(v_pos.accuracy_m) end);
  update public.games set sos = v_sos where id = p_game;
  perform private.emit(p_game, 'all', 'sos', v_sos);
end;
$$;

-- Levée de l'alerte : la personne qui l'a lancée, l'hôte ou un administrateur.
-- La partie reste en pause : la reprise demande ensuite une action de l'hôte.
create or replace function public.sos_resolve(p_game uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
  v_host uuid;
  v_note text := left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 200);
begin
  select * into v_g from public.games where id = p_game for update;
  if not found then perform private.fail('E_GAME_NOT_FOUND'); end if;
  if v_g.sos is null then perform private.fail('E_NO_SOS'); end if;
  select host_id into v_host from public.rooms where id = v_g.room_id;
  if not (auth.uid() = v_host or auth.uid()::text = v_g.sos ->> 'u' or private.role_rank(private.my_role()) >= 3) then
    perform private.fail('E_FORBIDDEN');
  end if;
  if private.role_rank(private.my_role()) >= 3 and auth.uid() <> v_host and auth.uid()::text <> v_g.sos ->> 'u' then
    perform private.audit('sos_resolve', 'game', p_game::text, coalesce(nullif(v_note, ''), 'SOS levé'));
  end if;
  update public.games set sos = null where id = p_game;
  perform private.emit(p_game, 'all', 'sos_resolved', jsonb_build_object('by', auth.uid(),
            'username', (select username from public.profiles where id = auth.uid()), 'note', v_note));
end;
$$;

-- -----------------------------------------------------------------------------
-- Heartbeat : + état de l'application, du GPS et de la batterie
-- (coéquipiers uniquement ; valeurs fournies par l'OS, jamais contournées)
-- -----------------------------------------------------------------------------
drop function if exists public.heartbeat(uuid);
create or replace function public.heartbeat(p_game uuid, p_app_state text default null, p_gps_state text default null, p_battery integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ps public.player_states%rowtype := private.require_participant(p_game);
  v_now timestamptz := private.now_();
  v_phase text;
  v_app text := case when p_app_state in ('foreground', 'background') then p_app_state end;
  v_gps text := case when p_gps_state in ('ok', 'searching', 'denied', 'off') then p_gps_state end;
  v_bat integer := case when p_battery between 0 and 100 then p_battery end;
begin
  perform private.rate_limit('heartbeat', 12, 60000);
  select phase into v_phase from public.games where id = p_game for update;

  update public.player_states
     set last_seen_at = v_now, connected = true,
         app_state = coalesce(v_app, app_state), gps_state = coalesce(v_gps, gps_state),
         battery = coalesce(v_bat, battery), health_at = v_now
   where game_id = p_game and user_id = v_ps.user_id;
  update public.room_members set last_seen_at = v_now
   where user_id = v_ps.user_id and room_id = (select room_id from public.games where id = p_game);

  if v_phase <> 'finished' and v_ps.status = 'active' and not v_ps.connected then
    perform private.emit(p_game, 'all', 'player_status',
      jsonb_build_object('u', v_ps.user_id, 'status', 'active', 'connected', true));
  end if;
  -- Santé envoyée à l'équipe seulement quand elle change notablement (pas de spam).
  if v_phase <> 'finished' and v_ps.status = 'active'
     and (v_app is distinct from v_ps.app_state or v_gps is distinct from v_ps.gps_state
          or (v_bat is not null and (v_ps.battery is null or abs(v_bat - v_ps.battery) >= 10 or (v_bat <= 15 and v_ps.battery > 15)))) then
    perform private.emit(p_game, v_ps.team, 'health', jsonb_build_object('u', v_ps.user_id,
              'battery', coalesce(v_bat, v_ps.battery), 'app', coalesce(v_app, v_ps.app_state), 'gps', coalesce(v_gps, v_ps.gps_state),
              'at', private.ms(v_now)));
  end if;

  perform private.tick(p_game);
  perform private.count_usage(1, 0, 0);
  return private.phase_payload(p_game) || jsonb_build_object('server_now', private.ms(private.now_()));
end;
$$;

-- -----------------------------------------------------------------------------
-- Vue de partie : extensions v0.4.0 (zone courante, Mister X, objectifs,
-- repères, SOS, santé des coéquipiers, statut GPS)
-- -----------------------------------------------------------------------------
create or replace function private.game_extras(p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.player_states%rowtype;
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
begin
  select * into v_g from public.games where id = p_game;
  select * into v_me from public.player_states where game_id = p_game and user_id = auth.uid();
  return jsonb_build_object(
    'zone', case when v_g.mode = 'royale' then private.zone_payload(p_game) end,
    'misterx', case when v_g.mode = 'misterx' then jsonb_build_object(
        'u', (select user_id from public.player_states where game_id = p_game and initial_team = 'fugitive' limit 1),
        'next_at', private.ms(v_g.misterx_next_at),
        'last', case when v_me.team = 'hunter' or v_g.phase = 'finished' then v_g.misterx_last end) end,
    'objectives', (select coalesce(jsonb_agg(jsonb_build_object('idx', o.idx, 'kind', o.kind, 'lat', o.lat, 'lng', o.lng,
                      'label', o.label, 'radius_m', o.radius_m, 'claimed_by', o.claimed_by, 'claimed_at', private.ms(o.claimed_at))
                      order by o.idx), '[]'::jsonb)
                     from public.game_objectives o where o.game_id = p_game),
    'extraction_open', v_g.extraction_opened,
    'markers', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'u', m.user_id, 'kind', m.kind, 'lat', m.lat, 'lng', m.lng,
                   'expires_at', private.ms(m.expires_at))), '[]'::jsonb)
                  from public.team_markers m
                 where m.game_id = p_game and m.team = v_me.team and v_me.status = 'active'
                   and m.removed_at is null and m.expires_at > v_now),
    'sos', v_g.sos,
    'health', (select coalesce(jsonb_object_agg(ps.user_id, jsonb_build_object('battery', ps.battery, 'app', ps.app_state,
                   'gps', ps.gps_state, 'at', private.ms(ps.health_at), 'last_pos_at', private.ms(ps.last_pos_at),
                   'gps_silent_since', private.ms(ps.gps_silent_since))), '{}'::jsonb)
                 from public.player_states ps
                where ps.game_id = p_game and ps.team = v_me.team and v_me.status = 'active'),
    'silent', (select coalesce(jsonb_agg(ps.user_id), '[]'::jsonb) from public.player_states ps
                where ps.game_id = p_game and ps.status = 'active' and ps.gps_silent_since is not null),
    'me', jsonb_build_object('objectives', v_me.objectives, 'extracted_at', private.ms(v_me.extracted_at),
            'gps_silent_since', private.ms(v_me.gps_silent_since))
  );
end;
$$;

create or replace function public.get_game_view(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view jsonb := private.game_view_base(p_game);
begin
  return v_view || jsonb_build_object('team_topic', private.team_topic(p_game, v_view -> 'me' ->> 'team'),
                                      'ext', private.game_extras(p_game));
end;
$$;

-- -----------------------------------------------------------------------------
-- Spectateurs : positions DIFFÉRÉES et approximatives de tous les joueurs,
-- réservées aux joueurs capturés/partis (aucune information exploitable en direct).
-- -----------------------------------------------------------------------------
create or replace function public.get_spectator_view(p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ps public.player_states%rowtype := private.require_participant(p_game);
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_delay integer;
  v_step double precision;
begin
  perform private.rate_limit('spectator', 12, 60000);
  select * into v_g from public.games where id = p_game;
  if v_g.phase = 'finished' then perform private.fail('E_GAME_FINISHED'); end if;
  if v_ps.status = 'active' then perform private.fail('E_NOT_SPECTATOR'); end if;
  if not (v_g.config -> 'spectators' ->> 'enabled')::boolean or not private.feature_on('spectators') then
    perform private.fail('E_FEATURE_DISABLED', 'spectators');
  end if;
  v_delay := (v_g.config -> 'spectators' ->> 'delay_s')::integer;
  v_step := greatest((v_g.config ->> 'approx_m')::double precision, 50);
  return jsonb_build_object(
    'delay_s', v_delay,
    'as_of', private.ms(v_now - make_interval(secs => v_delay)),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('u', ps.user_id, 'team', ps.team, 'status', ps.status)
                   || coalesce((select private.snap(v_g.config -> 'zone', h.lat, h.lng, v_step)
                                       || jsonb_build_object('at', private.ms(h.recorded_at))
                                  from private.position_history h
                                 where h.game_id = p_game and h.user_id = ps.user_id
                                   and h.recorded_at <= v_now - make_interval(secs => v_delay)
                                 order by h.recorded_at desc limit 1), '{}'::jsonb)), '[]'::jsonb)
                  from public.player_states ps where ps.game_id = p_game and ps.status = 'active')
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Replay : trajets reconstruits (arrondis à 10 m, 1 point / 10 s), pendant
-- 24 h maximum, pour les participants seulement, si l'hôte l'a activé.
-- Un joueur qui a utilisé l'arrêt de sécurité n'a plus de trajet (effacé).
-- -----------------------------------------------------------------------------
create or replace function public.get_replay(p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('replay', 6, 60000);
  select * into v_g from public.games where id = p_game;
  if v_g.phase <> 'finished' then perform private.fail('E_GAME_NOT_FINISHED'); end if;
  if not (v_g.config -> 'replay' ->> 'enabled')::boolean or not private.feature_on('replay') then
    perform private.fail('E_FEATURE_DISABLED', 'replay');
  end if;
  if v_g.ended_at < private.now_() - interval '24 hours' then perform private.fail('E_REPLAY_EXPIRED'); end if;
  return jsonb_build_object(
    'started_at', private.ms(v_g.running_at), 'ended_at', private.ms(v_g.ended_at),
    'zone', v_g.config -> 'zone',
    'tracks', (select coalesce(jsonb_agg(jsonb_build_object('u', t.user_id, 'team', t.initial_team,
                  'username', t.username, 'points', t.points)), '[]'::jsonb)
                 from (select ps.user_id, ps.initial_team, p.username,
                              (select coalesce(jsonb_agg(private.snap(v_g.config -> 'zone', s.lat, s.lng, 10)
                                         || jsonb_build_object('t', private.ms(s.recorded_at)) order by s.recorded_at), '[]'::jsonb)
                                 from (select distinct on (floor(extract(epoch from h.recorded_at) / 10)) h.lat, h.lng, h.recorded_at
                                         from private.position_history h
                                        where h.game_id = p_game and h.user_id = ps.user_id
                                        order by floor(extract(epoch from h.recorded_at) / 10), h.recorded_at) s) as points
                         from public.player_states ps join public.profiles p on p.id = ps.user_id
                        where ps.game_id = p_game) t),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('t', e.type, 'd', e.payload, 'at', private.ms(e.created_at)) order by e.id), '[]'::jsonb)
                 from public.game_events e
                where e.game_id = p_game and e.stream = 'all'
                  and e.type in ('capture', 'objective_claimed', 'extracted', 'zone_shrink', 'phase_changed', 'game_finished', 'sos'))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Succès (déblocage serveur, purement ludiques) et séries
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists win_streak integer not null default 0,
  add column if not exists best_streak integer not null default 0,
  add column if not exists objectives_total integer not null default 0;

create table if not exists public.achievements (
  key         text primary key,
  name        text not null,
  description text not null,
  metric      text not null,
  threshold   integer not null,
  sort_order  integer not null default 0
);
alter table public.achievements enable row level security;
revoke all on public.achievements from anon, authenticated, public;
grant select on public.achievements to authenticated;
drop policy if exists achievements_read on public.achievements;
create policy achievements_read on public.achievements for select to authenticated using (true);

insert into public.achievements (key, name, description, metric, threshold, sort_order) values
  ('first_game',   'Premier pas',        'Terminer une première partie.',                        'games_played',     1,  10),
  ('games_10',     'Habitué',            'Terminer 10 parties.',                                 'games_played',     10, 11),
  ('games_50',     'Vétéran',            'Terminer 50 parties.',                                 'games_played',     50, 12),
  ('first_win',    'Première victoire',  'Gagner une partie.',                                   'wins',             1,  20),
  ('wins_10',      'Gagneur',            'Gagner 10 parties.',                                   'wins',             10, 21),
  ('streak_3',     'Sur une lancée',     'Gagner 3 parties d''affilée.',                         'best_streak',      3,  22),
  ('first_capture','Première capture',   'Capturer un Fugitif.',                                 'captures',         1,  30),
  ('captures_25',  'Traqueur',           'Capturer 25 Fugitifs.',                                'captures',         25, 31),
  ('first_beacon', 'Éclaireur',          'Atteindre une première balise.',                       'objectives_total', 1,  40),
  ('beacons_20',   'Cartographe',        'Atteindre 20 balises.',                                'objectives_total', 20, 41),
  ('extracted',    'Exfiltré',           'Rejoindre le point d''extraction à temps.',            'special',          1,  50),
  ('misterx_win',  'Insaisissable',      'Gagner une partie en tant que Mister X.',              'special',          1,  51),
  ('royale_win',   'Dernier cercle',     'Survivre jusqu''au bout d''une partie Royale.',       'special',          1,  52)
on conflict (key) do update set name = excluded.name, description = excluded.description, metric = excluded.metric,
  threshold = excluded.threshold, sort_order = excluded.sort_order;

create table if not exists public.player_achievements (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  key         text not null references public.achievements (key) on delete cascade,
  unlocked_at timestamptz not null default now(),
  game_id     uuid references public.games (id) on delete set null,
  primary key (user_id, key)
);
alter table public.player_achievements enable row level security;
revoke all on public.player_achievements from anon, authenticated, public;
grant select on public.player_achievements to authenticated;
drop policy if exists player_achievements_read on public.player_achievements;
create policy player_achievements_read on public.player_achievements for select to authenticated using (true);

-- Fin de partie : objectifs et extraction dans le score, séries, succès.
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
  v_pts integer;
  v_bonus integer;
  r record;
begin
  select * into v_g from public.games where id = p_game;
  if v_g.phase = 'finished' then return; end if;
  v_pts := coalesce((v_g.config -> 'objectives' ->> 'points_each')::integer, 0);
  v_bonus := coalesce((v_g.config -> 'objectives' ->> 'extraction_bonus')::integer, 0);

  update public.games
     set phase = 'finished', ended_at = v_now, winner = p_winner, end_reason = p_reason,
         phase_ends_at = null, next_radar_at = null, phase_started_at = v_now,
         zone_next_at = null, misterx_next_at = null, sos = null
   where id = p_game
   returning * into v_g;

  insert into public.game_statistics (game_id, user_id, room_id, team, initial_team, final_status, outcome,
                                      captures, survival_seconds, distance, abilities_used, score, counted, objectives, extracted)
  select p_game, s.user_id, v_g.room_id, s.team, s.initial_team, s.status, s.outcome,
         s.captures, s.survival, s.distance, s.abilities_used,
         case
           when s.status = 'abandoned' then 0
           when s.initial_team = 'hunter' then s.captures * 100 + case when s.outcome = 'win' then 200 else 0 end
           else s.survival
                + case when s.status = 'active' and s.team = 'fugitive' then 300 else 0 end
                + s.captures * 100
                + case when s.outcome = 'win' then 100 else 0 end
                + s.objectives * v_pts
                + case when s.extracted_at is not null then v_bonus else 0 end
         end,
         v_counted, s.objectives, s.extracted_at is not null
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
           total_score = p.total_score + st.score,
           objectives_total = p.objectives_total + st.objectives,
           win_streak = case when st.outcome = 'win' then p.win_streak + 1 when st.outcome = 'draw' then p.win_streak else 0 end,
           best_streak = greatest(p.best_streak, case when st.outcome = 'win' then p.win_streak + 1 else 0 end)
      from public.game_statistics st
      join public.player_states ps on ps.game_id = st.game_id and ps.user_id = st.user_id
     where st.game_id = p_game and p.id = st.user_id;

    -- Succès à seuil (statistiques cumulées réelles).
    for r in
      insert into public.player_achievements (user_id, key, unlocked_at, game_id)
      select p.id, a.key, v_now, p_game
        from public.game_statistics st
        join public.profiles p on p.id = st.user_id
        join public.achievements a on a.metric <> 'special'
       where st.game_id = p_game
         and case a.metric when 'games_played' then p.games_played when 'wins' then p.wins when 'best_streak' then p.best_streak
                           when 'captures' then p.captures when 'objectives_total' then p.objectives_total else 0 end >= a.threshold
      on conflict do nothing
      returning user_id, key
    loop
      perform private.emit(p_game, 'p:' || r.user_id::text, 'achievement', jsonb_build_object('key', r.key));
    end loop;
    -- Succès spéciaux liés à cette partie.
    for r in
      insert into public.player_achievements (user_id, key, unlocked_at, game_id)
      select st.user_id, k.key, v_now, p_game
        from public.game_statistics st
        cross join lateral (values
          ('extracted', st.extracted),
          ('misterx_win', v_g.mode = 'misterx' and st.initial_team = 'fugitive' and st.outcome = 'win'),
          ('royale_win', v_g.mode = 'royale' and st.initial_team = 'fugitive' and st.final_status = 'active' and st.outcome = 'win')
        ) as k(key, ok)
       where st.game_id = p_game and k.ok
      on conflict do nothing
      returning user_id, key
    loop
      perform private.emit(p_game, 'p:' || r.user_id::text, 'achievement', jsonb_build_object('key', r.key));
    end loop;
  end if;

  update public.rooms set status = 'results' where id = v_g.room_id and current_game_id = p_game;

  select jsonb_agg(jsonb_build_object(
           'u', ps.user_id, 'team', ps.team, 'initial_team', ps.initial_team, 'status', ps.status,
           'captures', ps.captures, 'score', st.score, 'outcome', st.outcome,
           'survival_seconds', st.survival_seconds, 'objectives', st.objectives, 'extracted', st.extracted) order by st.score desc)
    into v_final
    from public.player_states ps
    join public.game_statistics st on st.game_id = ps.game_id and st.user_id = ps.user_id
   where ps.game_id = p_game;

  perform private.emit(p_game, 'all', 'game_finished',
    jsonb_build_object('winner', p_winner, 'reason', p_reason, 'ended_at', private.ms(v_now), 'players', coalesce(v_final, '[]'::jsonb)));
  perform private.room_emit(v_g.room_id, 'game_finished', jsonb_build_object('game_id', p_game, 'winner', p_winner));
end;
$$;

create or replace function public.get_my_achievements()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', a.key, 'name', a.name, 'description', a.description, 'threshold', a.threshold,
           'progress', case a.metric when 'games_played' then p.games_played when 'wins' then p.wins
                         when 'best_streak' then p.best_streak when 'captures' then p.captures
                         when 'objectives_total' then p.objectives_total
                         else case when pa.user_id is not null then 1 else 0 end end,
           'unlocked_at', private.ms(pa.unlocked_at)) order by a.sort_order), '[]'::jsonb)
    from public.achievements a
    join public.profiles p on p.id = auth.uid()
    left join public.player_achievements pa on pa.user_id = p.id and pa.key = a.key;
$$;

-- Statistiques détaillées : uniquement des parties terminées et comptées.
create or replace function public.get_my_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'streak', (select win_streak from public.profiles where id = auth.uid()),
    'best_streak', (select best_streak from public.profiles where id = auth.uid()),
    'objectives', (select objectives_total from public.profiles where id = auth.uid()),
    'by_mode', (select coalesce(jsonb_object_agg(m.mode, m.s), '{}'::jsonb) from (
       select g.mode, jsonb_build_object(
                'games', count(*), 'wins', count(*) filter (where st.outcome = 'win'),
                'losses', count(*) filter (where st.outcome = 'loss'), 'draws', count(*) filter (where st.outcome = 'draw'),
                'captures', coalesce(sum(st.captures), 0), 'objectives', coalesce(sum(st.objectives), 0),
                'avg_survival_s', coalesce(round(avg(st.survival_seconds) filter (where st.initial_team = 'fugitive')), 0),
                'as_hunter', count(*) filter (where st.initial_team = 'hunter'),
                'as_fugitive', count(*) filter (where st.initial_team = 'fugitive')) as s
         from public.game_statistics st join public.games g on g.id = st.game_id
        where st.user_id = auth.uid() and st.counted
        group by g.mode) m)
  );
$$;

-- -----------------------------------------------------------------------------
-- Rétention (quotidienne via pg_cron)
-- -----------------------------------------------------------------------------
create or replace function private.cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events integer; v_pos_events integer; v_rooms integer; v_games integer; v_positions integer; v_misc integer := 0; v_n integer;
begin
  with stale as (
    select id from public.games where phase <> 'finished' and updated_at < private.now_() - interval '6 hours'
  )
  update public.games g set phase = 'finished', winner = 'draw', end_reason = 'aborted', ended_at = private.now_()
    from stale where g.id = stale.id;
  get diagnostics v_games = row_count;

  delete from private.position_history h using public.games g
   where h.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '24 hours';
  get diagnostics v_positions = row_count;
  delete from private.player_positions p using public.games g
   where p.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '24 hours';

  delete from public.game_events e using public.games g
   where e.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '24 hours'
     and private.is_positional_event(e.type);
  get diagnostics v_pos_events = row_count;

  delete from public.team_markers m using public.games g
   where m.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '24 hours';
  get diagnostics v_n = row_count; v_misc := v_misc + v_n;
  update public.games set misterx_last = null
   where phase = 'finished' and misterx_last is not null and ended_at < private.now_() - interval '24 hours';
  delete from private.capture_tokens where expires_at < private.now_() - interval '1 hour';
  get diagnostics v_n = row_count; v_misc := v_misc + v_n;
  delete from private.client_errors where created_at < private.now_() - interval '14 days';

  delete from public.game_events e using public.games g
   where e.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '30 days';
  get diagnostics v_events = row_count;

  update public.rooms set status = 'closed'
   where status <> 'closed' and last_activity_at < private.now_() - interval '7 days';
  get diagnostics v_rooms = row_count;
  delete from private.rate_limits where window_start < private.now_() - interval '1 day';
  return jsonb_build_object('games_closed', v_games, 'positions_deleted', v_positions,
                            'events_deleted', v_events + v_pos_events, 'position_events_deleted', v_pos_events,
                            'other_deleted', v_misc, 'rooms_closed', v_rooms);
end;
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
  public.team_message(uuid, text), public.place_marker(uuid, text, double precision, double precision, integer),
  public.remove_marker(uuid, uuid), public.sos_raise(uuid, text, boolean), public.sos_resolve(uuid, text),
  public.heartbeat(uuid, text, text, integer), public.get_spectator_view(uuid), public.get_replay(uuid),
  public.get_my_achievements(), public.get_my_stats(), public.get_capture_token(uuid), public.capture_by_token(uuid, text),
  public.get_game_view(uuid), public.start_game(uuid), public.report_position(uuid, double precision, double precision, real, bigint, real, real),
  public.attempt_capture(uuid), public.resume_game(uuid)
  from public, anon;
grant execute on function
  public.team_message(uuid, text), public.place_marker(uuid, text, double precision, double precision, integer),
  public.remove_marker(uuid, uuid), public.sos_raise(uuid, text, boolean), public.sos_resolve(uuid, text),
  public.heartbeat(uuid, text, text, integer), public.get_spectator_view(uuid), public.get_replay(uuid),
  public.get_my_achievements(), public.get_my_stats(), public.get_capture_token(uuid), public.capture_by_token(uuid, text),
  public.get_game_view(uuid), public.start_game(uuid), public.report_position(uuid, double precision, double precision, real, bigint, real, real),
  public.attempt_capture(uuid), public.resume_game(uuid)
  to authenticated;
