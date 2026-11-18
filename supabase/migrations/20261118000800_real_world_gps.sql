-- =============================================================================
-- 0800 — Jeu géolocalisé dans le monde réel (GPS).
--
-- Remplace la grille virtuelle par des positions GPS réelles, transmises par
-- l'application mobile UNIQUEMENT pendant une partie active, après
-- consentement explicite. Voir docs/MIGRATION_MOBILE_GPS.md.
--
-- Principes :
--  * Positions brutes stockées dans le schéma `private` (non exposé par
--    l'API), lisibles uniquement par les fonctions serveur.
--  * Seules des positions ARRONDIES sont diffusées : ~10 m aux coéquipiers,
--    `approx_m` (défaut 30 m, jamais plus fin que la précision GPS) aux
--    adversaires, à fréquence limitée.
--  * Le serveur valide tout : participation, consentement, phase, fraîcheur,
--    vitesse plausible, zone, captures, radar, capacités.
--  * Rétention : positions brutes effacées 24 h après la fin de la partie,
--    immédiatement en cas d'arrêt de sécurité ou d'abandon.
--
-- Données conservées : aucune table n'est supprimée. Les colonnes de grille
-- (player_states.x/y, games.map) restent pour compatibilité mais ne sont plus
-- utilisées. Les fonctions propres à la grille sont supprimées (fin du fichier).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schéma
-- -----------------------------------------------------------------------------
alter table public.room_members add column if not exists location_consent_at timestamptz;

alter table public.player_states alter column x drop not null;
alter table public.player_states alter column y drop not null;
alter table public.player_states
  add column if not exists last_pos_at timestamptz,
  add column if not exists accuracy_m real,
  add column if not exists out_of_zone_since timestamptz,
  add column if not exists enemy_broadcast_at timestamptz,
  add column if not exists enemy_view jsonb,
  add column if not exists decoy_until timestamptz,
  add column if not exists decoy_east_m real,
  add column if not exists decoy_south_m real;

comment on column public.player_states.distance is 'Distance parcourue en mètres (GPS).';
comment on column public.player_states.enemy_view is 'Dernière position APPROXIMATIVE diffusée aux adversaires (jamais la position brute).';

-- Dernière position brute connue (une ligne par joueur et par partie).
create table if not exists private.player_positions (
  game_id      uuid not null references public.games (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  accuracy_m   real not null,
  speed_mps    real,
  heading_deg  real,
  recorded_at  timestamptz not null,
  received_at  timestamptz not null,
  primary key (game_id, user_id),
  constraint player_positions_lat check (lat between -90 and 90),
  constraint player_positions_lng check (lng between -180 and 180)
);

-- Historique brut (anti-triche, distance) — rétention courte.
create table if not exists private.position_history (
  id           bigint generated always as identity primary key,
  game_id      uuid not null references public.games (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  accuracy_m   real not null,
  recorded_at  timestamptz not null
);
create index if not exists position_history_game_idx on private.position_history (game_id, user_id, recorded_at);

alter table private.player_positions enable row level security;
alter table private.position_history enable row level security;
revoke all on private.player_positions, private.position_history from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Catalogue des capacités adapté au monde réel
-- -----------------------------------------------------------------------------
update public.abilities set enabled = false where key in ('sprint', 'barrier');
update public.abilities set description = 'Votre position disparaît des cartes adverses pendant quelques secondes. Le radar peut toujours vous détecter.', duration_s = 30, cooldown_s = 180, max_uses = 2 where key = 'ghost';
update public.abilities set description = 'Votre position et vos signaux radar deviennent très imprécis (environ 150 m) pour les Chasseurs.', duration_s = 60, cooldown_s = 180, max_uses = 2, params = '{"approx_m":150}' where key = 'jammer';
update public.abilities set description = 'Révèle plus précisément les Fugitifs situés à moins de 250 m de vous.', targeting = 'none', duration_s = 20, cooldown_s = 90, max_uses = 0, params = '{"radius_m":250,"factor":3}' where key = 'scan';
update public.abilities set description = 'Indique la direction et la distance approximative du Fugitif le plus proche.' where key = 'tracker';
insert into public.abilities (key, team, name, description, targeting, duration_s, cooldown_s, max_uses, params, notify, sort_order) values
  ('decoy', 'fugitive', 'Leurre', 'Les Chasseurs voient une fausse position à environ 150 m de vous.', 'none', 45, 180, 2, '{"offset_m":150}', 'team', 25),
  ('sonar', 'hunter', 'Sonar', 'Compte les Fugitifs présents à moins de 150 m de vous.', 'none', 0, 45, 0, '{"radius_m":150}', 'team', 25)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Configuration GPS (miroir : packages/shared/src/config.ts)
-- -----------------------------------------------------------------------------
create or replace function private.cfg_num6(c jsonb, k text, d numeric, lo numeric, hi numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(lo, least(hi, coalesce(
    case when jsonb_typeof(c -> k) = 'number' then round((c ->> k)::numeric, 6) end, d)))
$$;

create or replace function private.normalize_zone(z jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_label text;
begin
  if z is null or jsonb_typeof(z) <> 'object' then
    z := '{}'::jsonb;
  end if;
  v_label := left(btrim(regexp_replace(
    coalesce(case when jsonb_typeof(z -> 'label') = 'string' then z ->> 'label' end, ''),
    '[<>"[:cntrl:]]', '', 'g')), 80);
  return jsonb_build_object(
    'lat',      private.cfg_num6(z, 'lat', 48.8556, -85, 85),
    'lng',      private.cfg_num6(z, 'lng', 2.347, -180, 180),
    'radius_m', private.cfg_int(z, 'radius_m', 500, 150, 3000),
    'label',    case when v_label = '' then 'Zone non définie' else v_label end,
    'set',      private.cfg_bool(z, 'set', false)
  );
end;
$$;

create or replace function private.normalize_config(c jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r jsonb := coalesce(c -> 'radar', '{}'::jsonb);
  ab jsonb := coalesce(c -> 'abilities', '{}'::jsonb);
  out_abilities jsonb := '{}'::jsonb;
  a record;
  ac jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then c := '{}'::jsonb; end if;
  if jsonb_typeof(r) <> 'object' then r := '{}'::jsonb; end if;
  if jsonb_typeof(ab) <> 'object' then ab := '{}'::jsonb; end if;

  for a in select * from public.abilities where enabled order by team, sort_order loop
    ac := coalesce(ab -> a.key, '{}'::jsonb);
    if jsonb_typeof(ac) <> 'object' then ac := '{}'::jsonb; end if;
    out_abilities := out_abilities || jsonb_build_object(a.key, jsonb_build_object(
      'enabled',    private.cfg_bool(ac, 'enabled', true),
      'duration_s', private.cfg_int(ac, 'duration_s', a.duration_s, 0, 300),
      'cooldown_s', private.cfg_int(ac, 'cooldown_s', a.cooldown_s, 5, 900),
      'max_uses',   private.cfg_int(ac, 'max_uses', a.max_uses, 0, 20)
    ));
  end loop;

  return jsonb_build_object(
    'mode',                private.cfg_enum(c, 'mode', 'classic', array['classic', 'infection']),
    'duration_s',          private.cfg_int(c, 'duration_s', 1800, 300, 7200),
    'prep_s',              private.cfg_int(c, 'prep_s', 120, 0, 900),
    'zone',                private.normalize_zone(c -> 'zone'),
    'hunter_ratio',        private.cfg_num(c, 'hunter_ratio', 0.3, 0.1, 0.6),
    'position_interval_s', private.cfg_int(c, 'position_interval_s', 5, 3, 30),
    'enemy_reveal',        private.cfg_enum(c, 'enemy_reveal', 'live', array['live', 'pulse']),
    'enemy_refresh_s',     private.cfg_int(c, 'enemy_refresh_s', 15, 5, 120),
    'approx_m',            private.cfg_int(c, 'approx_m', 30, 10, 200),
    'stale_after_s',       private.cfg_int(c, 'stale_after_s', 45, 15, 300),
    'capture_radius_m',    private.cfg_int(c, 'capture_radius_m', 15, 5, 50),
    'capture_cooldown_s',  private.cfg_int(c, 'capture_cooldown_s', 10, 3, 120),
    'max_accuracy_m',      private.cfg_int(c, 'max_accuracy_m', 35, 10, 100),
    'max_speed_mps',       private.cfg_int(c, 'max_speed_mps', 12, 3, 40),
    'out_of_zone_grace_s', private.cfg_int(c, 'out_of_zone_grace_s', 60, 15, 600),
    'disconnect_grace_s',  private.cfg_int(c, 'disconnect_grace_s', 180, 30, 900),
    'radar', jsonb_build_object(
      'enabled',    private.cfg_bool(r, 'enabled', true),
      'mode',       private.cfg_enum(r, 'mode', 'auto', array['auto', 'manual']),
      'interval_s', private.cfg_int(r, 'interval_s', 120, 30, 900),
      'precision',  private.cfg_enum(r, 'precision', 'direction', array['direction', 'sector', 'zone']),
      'teams',      private.cfg_enum(r, 'teams', 'hunter', array['hunter', 'fugitive', 'both']),
      'cooldown_s', private.cfg_int(r, 'cooldown_s', 120, 15, 900),
      'reveal_s',   private.cfg_int(r, 'reveal_s', 20, 5, 120),
      'max_uses',   private.cfg_int(r, 'max_uses', 0, 0, 50)
    ),
    'abilities', out_abilities
  );
end;
$$;

update public.rooms set config = private.normalize_config(config);

-- Modifier les règles d'un salon annule les consentements (le contexte change).
create or replace function private.reset_consent_on_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.config is distinct from old.config then
    update public.room_members set location_consent_at = null where room_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists rooms_reset_consent on public.rooms;
create trigger rooms_reset_consent after update of config on public.rooms
  for each row execute function private.reset_consent_on_config();

-- -----------------------------------------------------------------------------
-- Géométrie (projection équirectangulaire locale, précise pour < 10 km)
-- Formules identiques à packages/shared/src/geo.ts
-- -----------------------------------------------------------------------------
create or replace function private.east_m(lat0 double precision, lng0 double precision, lng double precision)
returns double precision language sql immutable set search_path = ''
as $$ select (lng - lng0) * 111320.0 * cos(radians(lat0)) $$;

create or replace function private.south_m(lat0 double precision, lat double precision)
returns double precision language sql immutable set search_path = ''
as $$ select (lat0 - lat) * 111320.0 $$;

create or replace function private.dist_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = ''
as $$
  select sqrt(power((lng2 - lng1) * 111320.0 * cos(radians((lat1 + lat2) / 2)), 2) + power((lat2 - lat1) * 111320.0, 2))
$$;

-- Cap (0 = Nord, sens horaire) de A vers B.
create or replace function private.bearing_deg(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = ''
as $$
  select mod((degrees(atan2((lng2 - lng1) * cos(radians((lat1 + lat2) / 2)), lat2 - lat1)) + 360)::numeric, 360)::double precision
$$;

create or replace function private.dir8(bearing double precision)
returns text language sql immutable set search_path = ''
as $$ select (array['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])[(floor(mod((bearing + 22.5)::numeric, 360) / 45))::integer + 1] $$;

create or replace function private.gps_band(d double precision)
returns text language sql immutable set search_path = ''
as $$ select case when d < 100 then 'near' when d < 300 then 'mid' else 'far' end $$;

-- Arrondi d'une position sur une grille de `step` mètres centrée sur la zone :
-- protège la position exacte tout en restant stable (pas de saut aléatoire).
create or replace function private.snap(p_zone jsonb, lat double precision, lng double precision, step double precision)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  lat0 double precision := (p_zone ->> 'lat')::double precision;
  lng0 double precision := (p_zone ->> 'lng')::double precision;
  e double precision := round(private.east_m(lat0, lng0, lng) / step) * step;
  s double precision := round(private.south_m(lat0, lat) / step) * step;
begin
  return jsonb_build_object(
    'lat', round((lat0 - s / 111320.0)::numeric, 6),
    'lng', round((lng0 + e / (111320.0 * cos(radians(lat0))))::numeric, 6));
end;
$$;

create or replace function private.offset_point(lat double precision, lng double precision, east double precision, south double precision)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('lat', round((lat - south / 111320.0)::numeric, 6),
                            'lng', round((lng + east / (111320.0 * cos(radians(lat))))::numeric, 6))
$$;

-- Position fraîche (moins de p_max_age secondes) d'un joueur, ou null.
create or replace function private.fresh_position(p_game uuid, p_user uuid, p_max_age integer)
returns private.player_positions
language sql stable security definer set search_path = ''
as $$
  select pp.* from private.player_positions pp
   where pp.game_id = p_game and pp.user_id = p_user
     and pp.received_at >= private.now_() - make_interval(secs => p_max_age)
$$;

-- -----------------------------------------------------------------------------
-- Consentement (lobby)
-- -----------------------------------------------------------------------------
create or replace function public.set_location_consent(p_room uuid, p_consent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.rate_limit('consent', 20, 60000);
  update public.room_members
     set location_consent_at = case when p_consent then private.now_() else null end,
         is_ready = case when p_consent then is_ready else false end
   where room_id = p_room and user_id = auth.uid();
  if not found then perform private.fail('E_NOT_MEMBER'); end if;
  perform private.room_emit(p_room, 'consent_changed');
end;
$$;

-- get_room_state expose désormais le consentement de chaque membre.
create or replace function public.get_room_state(p_room uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_game jsonb;
begin
  select * into v_room from public.rooms where id = p_room;
  if not found or v_room.status = 'closed' then perform private.fail('E_ROOM_NOT_FOUND'); end if;
  if not private.is_room_member(p_room, v_uid) then perform private.fail('E_NOT_MEMBER'); end if;

  select jsonb_build_object('id', g.id, 'phase', g.phase, 'winner', g.winner, 'end_reason', g.end_reason,
                            'participant', exists (select 1 from public.player_states ps where ps.game_id = g.id and ps.user_id = v_uid))
    into v_game
    from public.games g where g.id = v_room.current_game_id;

  return jsonb_build_object(
    'server_now', private.ms(private.now_()),
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'name', v_room.name, 'host_id', v_room.host_id,
      'status', v_room.status, 'config', v_room.config, 'allow_team_choice', v_room.allow_team_choice,
      'max_players', v_room.max_players, 'current_game_id', v_room.current_game_id, 'created_at', v_room.created_at),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'username', p.username, 'avatar', p.avatar, 'team', m.team,
               'is_ready', m.is_ready, 'joined_at', m.joined_at, 'last_seen_at', m.last_seen_at,
               'is_host', m.user_id = v_room.host_id, 'is_guest', p.is_guest,
               'location_consent', m.location_consent_at is not null)
             order by m.joined_at)
        from public.room_members m join public.profiles p on p.id = m.user_id
       where m.room_id = p_room), '[]'::jsonb),
    'game', v_game
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Démarrage : zone réelle définie + consentement de TOUS les membres requis.
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
  v_game_id uuid;
  v_n integer; v_nh integer; v_nf integer; v_unassigned integer; v_no_consent integer;
  v_prep integer;
begin
  perform private.rate_limit('start_game', 5, 60000);
  if v_room.status <> 'lobby' then perform private.fail('E_NOT_IN_LOBBY'); end if;

  select count(*), count(*) filter (where team = 'hunter'), count(*) filter (where team = 'fugitive'),
         count(*) filter (where team is null), count(*) filter (where location_consent_at is null)
    into v_n, v_nh, v_nf, v_unassigned, v_no_consent
    from public.room_members where room_id = p_room;
  if v_n < 2 then perform private.fail('E_NOT_ENOUGH_PLAYERS'); end if;
  if v_unassigned > 0 then perform private.fail('E_TEAMS_INCOMPLETE'); end if;
  if v_nh = 0 or v_nf = 0 then perform private.fail('E_TEAMS_UNBALANCED'); end if;

  v_cfg := private.normalize_config(v_room.config);
  if not (v_cfg -> 'zone' ->> 'set')::boolean then perform private.fail('E_ZONE_NOT_SET'); end if;
  if v_no_consent > 0 then perform private.fail('E_CONSENT_MISSING', v_no_consent::text); end if;
  v_prep := (v_cfg ->> 'prep_s')::integer;

  insert into public.games (room_id, mode, phase, config, map, seed, created_by, started_at,
                            phase_started_at, phase_ends_at, running_at, next_radar_at)
  values (p_room, v_cfg ->> 'mode',
          case when v_prep > 0 then 'preparation' else 'running' end,
          v_cfg, jsonb_build_object('kind', 'gps', 'zone', v_cfg -> 'zone'), 0, auth.uid(), v_now, v_now,
          v_now + make_interval(secs => case when v_prep > 0 then v_prep else (v_cfg ->> 'duration_s')::integer end),
          case when v_prep > 0 then null else v_now end,
          case when v_prep = 0 and (((v_cfg -> 'radar' ->> 'enabled')::boolean and v_cfg -> 'radar' ->> 'mode' = 'auto')
                                    or v_cfg ->> 'enemy_reveal' = 'pulse')
               then v_now + make_interval(secs => (v_cfg -> 'radar' ->> 'interval_s')::integer) end)
  returning id into v_game_id;

  -- Pas de position initiale : chacun envoie sa position GPS dès l'ouverture de la partie.
  insert into public.player_states (game_id, user_id, team, initial_team, x, y, steps, steps_at, last_seen_at, joined_at)
  select v_game_id, m.user_id, m.team, m.team, null, null, 0, v_now, v_now, v_now
    from public.room_members m where m.room_id = p_room;

  update public.rooms set status = 'playing', current_game_id = v_game_id where id = p_room;
  update public.room_members set is_ready = false where room_id = p_room;

  perform private.emit(v_game_id, 'all', 'phase_changed', private.phase_payload(v_game_id));
  perform private.room_emit(p_room, 'game_started', jsonb_build_object('game_id', v_game_id));
  perform private.count_usage(1, 0, 0);
  return jsonb_build_object('game_id', v_game_id);
end;
$$;

-- Passage en partie : le radar démarre aussi en mode de révélation périodique.
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
         next_radar_at = case when ((v_cfg -> 'radar' ->> 'enabled')::boolean and v_cfg -> 'radar' ->> 'mode' = 'auto')
                                   or v_cfg ->> 'enemy_reveal' = 'pulse'
                              then v_now + make_interval(secs => (v_cfg -> 'radar' ->> 'interval_s')::integer) end
   where id = p_game;
  perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
end;
$$;

-- La visibilité n'est plus calculée par cases : fonction conservée (appelée
-- par abandon_player) mais sans effet.
create or replace function private.refresh_vis(p_game uuid)
returns void language plpgsql security definer set search_path = ''
as $$ begin return; end; $$;

-- -----------------------------------------------------------------------------
-- Diffusion de la position approximative d'un joueur à l'équipe adverse.
-- Tient compte de la préparation, du Fantôme, du Brouilleur et du Leurre.
-- -----------------------------------------------------------------------------
create or replace function private.enemy_payload(p_game uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_ps public.player_states%rowtype;
  v_pos private.player_positions%rowtype;
  v_now timestamptz := private.now_();
  v_step double precision;
  v_lat double precision; v_lng double precision;
  v_snap jsonb;
begin
  select * into v_g from public.games where id = p_game;
  select * into v_ps from public.player_states where game_id = p_game and user_id = p_user;
  select * into v_pos from private.player_positions where game_id = p_game and user_id = p_user;
  if v_pos.game_id is null or v_ps.status <> 'active' then return null; end if;
  -- Préparation : les Chasseurs ne voient pas les Fugitifs.
  if v_ps.team = 'fugitive' and (v_g.phase = 'preparation' or (v_g.phase = 'paused' and v_g.paused_from = 'preparation')) then
    return null;
  end if;
  if v_ps.ghost_until is not null and v_ps.ghost_until > v_now then
    return jsonb_build_object('u', p_user, 'hidden', true, 'at', private.ms(v_now));
  end if;

  v_step := greatest((v_g.config ->> 'approx_m')::double precision, v_pos.accuracy_m);
  if v_ps.jam_until is not null and v_ps.jam_until > v_now then
    v_step := greatest(v_step, 150);
  end if;
  v_lat := v_pos.lat;
  v_lng := v_pos.lng;
  if v_ps.decoy_until is not null and v_ps.decoy_until > v_now then
    v_lat := v_lat - coalesce(v_ps.decoy_south_m, 0) / 111320.0;
    v_lng := v_lng + coalesce(v_ps.decoy_east_m, 0) / (111320.0 * cos(radians(v_pos.lat)));
  end if;
  v_snap := private.snap(v_g.config -> 'zone', v_lat, v_lng, v_step);
  return v_snap || jsonb_build_object('u', p_user, 'acc', round(v_step), 'at', private.ms(v_pos.received_at));
end;
$$;

create or replace function private.broadcast_enemy(p_game uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team text;
  v_payload jsonb := private.enemy_payload(p_game, p_user);
begin
  select team into v_team from public.player_states where game_id = p_game and user_id = p_user;
  if v_payload is null then return; end if;
  update public.player_states set enemy_broadcast_at = private.now_(), enemy_view = v_payload
   where game_id = p_game and user_id = p_user;
  perform private.emit(p_game, private.enemy_of(v_team), 'enemy_pos', v_payload);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : envoi de position GPS
-- -----------------------------------------------------------------------------
create or replace function public.report_position(
  p_game uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy real,
  p_recorded_at bigint,
  p_speed real default null,
  p_heading real default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := private.now_();
  v_g public.games%rowtype;
  v_ps public.player_states%rowtype;
  v_prev private.player_positions%rowtype;
  v_cfg jsonb;
  v_recorded timestamptz;
  v_d double precision := 0;
  v_dt double precision;
  v_out boolean;
  v_ally jsonb;
  v_live boolean;
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('position', 3, 3000);
  perform private.tick(p_game);

  select * into v_g from public.games where id = p_game for update;
  select * into v_ps from public.player_states where game_id = p_game and user_id = auth.uid() for update;
  v_cfg := v_g.config;

  if v_g.phase = 'finished' then perform private.fail('E_GAME_FINISHED'); end if;
  if v_ps.status <> 'active' then perform private.fail('E_NOT_ACTIVE'); end if;
  if not exists (select 1 from public.room_members
                  where room_id = v_g.room_id and user_id = v_ps.user_id and location_consent_at is not null) then
    perform private.fail('E_CONSENT_REQUIRED');
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy is null or p_accuracy < 0 or p_accuracy > 5000 then
    perform private.fail('E_INVALID_POSITION');
  end if;
  v_recorded := to_timestamp(p_recorded_at / 1000.0);
  if v_recorded > v_now + interval '15 seconds' or v_recorded < v_now - interval '2 minutes' then
    perform private.fail('E_STALE_POSITION');
  end if;

  select * into v_prev from private.player_positions where game_id = p_game and user_id = v_ps.user_id;
  if v_prev.game_id is not null then
    if v_recorded <= v_prev.recorded_at then
      -- Message en retard : ignoré sans erreur.
      return jsonb_build_object('accepted', false, 'reason', 'out_of_order', 'server_now', private.ms(v_now));
    end if;
    v_d := private.dist_m(v_prev.lat, v_prev.lng, p_lat, p_lng);
    v_dt := greatest(1, extract(epoch from (v_recorded - v_prev.recorded_at)));
    -- Vitesse implausible (au-delà de l'incertitude GPS) : rejet anti-triche.
    if (v_d - v_prev.accuracy_m - p_accuracy) / v_dt > (v_cfg ->> 'max_speed_mps')::double precision then
      perform private.fail('E_IMPLAUSIBLE_SPEED');
    end if;
  end if;

  insert into private.player_positions as pp (game_id, user_id, lat, lng, accuracy_m, speed_mps, heading_deg, recorded_at, received_at)
  values (p_game, v_ps.user_id, p_lat, p_lng, p_accuracy, p_speed, p_heading, v_recorded, v_now)
  on conflict (game_id, user_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, speed_mps = excluded.speed_mps,
        heading_deg = excluded.heading_deg, recorded_at = excluded.recorded_at, received_at = excluded.received_at;
  insert into private.position_history (game_id, user_id, lat, lng, accuracy_m, recorded_at)
  values (p_game, v_ps.user_id, p_lat, p_lng, p_accuracy, v_recorded);

  -- Zone de jeu.
  v_out := private.dist_m((v_cfg -> 'zone' ->> 'lat')::double precision, (v_cfg -> 'zone' ->> 'lng')::double precision, p_lat, p_lng)
           > (v_cfg -> 'zone' ->> 'radius_m')::double precision + least(p_accuracy, 50);

  update public.player_states
     set last_pos_at = v_now, accuracy_m = p_accuracy, last_seen_at = v_now, connected = true,
         distance = distance + case when v_prev.game_id is not null and p_accuracy <= 50 and v_d > p_accuracy / 2 then round(v_d)::integer else 0 end,
         out_of_zone_since = case when v_out then coalesce(out_of_zone_since, v_now) else null end
   where game_id = p_game and user_id = v_ps.user_id;

  if v_out and v_ps.out_of_zone_since is null then
    perform private.emit(p_game, 'all', 'zone_status', jsonb_build_object('u', v_ps.user_id, 'out', true, 'at', private.ms(v_now)));
  elsif not v_out and v_ps.out_of_zone_since is not null then
    perform private.emit(p_game, 'all', 'zone_status', jsonb_build_object('u', v_ps.user_id, 'out', false, 'at', private.ms(v_now)));
  end if;

  -- Coéquipiers : position arrondie à ~10 m.
  v_ally := private.snap(v_cfg -> 'zone', p_lat, p_lng, 10)
            || jsonb_build_object('u', v_ps.user_id, 'acc', round(greatest(p_accuracy, 10)), 'at', private.ms(v_now));
  perform private.emit(p_game, v_ps.team, 'pos', v_ally);

  -- Adversaires : position approximative, fréquence limitée (mode « live »).
  v_live := v_cfg ->> 'enemy_reveal' = 'live';
  if v_live and (v_ps.enemy_broadcast_at is null
                 or v_ps.enemy_broadcast_at <= v_now - make_interval(secs => (v_cfg ->> 'enemy_refresh_s')::integer)) then
    perform private.broadcast_enemy(p_game, v_ps.user_id);
  end if;

  perform private.count_usage(1, 0, 0);
  return jsonb_build_object('accepted', true, 'out_of_zone', v_out, 'server_now', private.ms(v_now),
                            'next_in_s', (v_cfg ->> 'position_interval_s')::integer);
end;
$$;

-- -----------------------------------------------------------------------------
-- Radar GPS (calcul serveur à partir des positions brutes)
-- -----------------------------------------------------------------------------
create or replace function private.radar_contacts_gps(p_game uuid, p_team text, p_precision text, p_olat double precision, p_olng double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_out jsonb := '[]'::jsonb;
  v_zone jsonb;
  v_d double precision; v_b double precision; v_r double precision; v_off double precision; v_ang double precision;
  e record;
begin
  select * into v_g from public.games where id = p_game;
  v_zone := v_g.config -> 'zone';
  for e in
    select ps.user_id, ps.jam_until, pp.lat, pp.lng, pp.received_at
      from public.player_states ps
      left join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
     where ps.game_id = p_game and ps.team = private.enemy_of(p_team) and ps.status = 'active'
     order by md5(ps.user_id::text || v_g.radar_pulse_count::text)
  loop
    if e.lat is null or e.received_at < v_now - make_interval(secs => (v_g.config ->> 'stale_after_s')::integer) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('lost', true));
    elsif e.jam_until is not null and e.jam_until > v_now then
      v_out := v_out || jsonb_build_array(jsonb_build_object('jammed', true));
    elsif p_precision = 'direction' and p_olat is not null then
      v_d := private.dist_m(p_olat, p_olng, e.lat, e.lng);
      v_b := private.bearing_deg(p_olat, p_olng, e.lat, e.lng);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'dir', private.dir8(v_b), 'band', private.gps_band(v_d), 'dist_m', (round(v_d / 50) * 50)::integer));
    elsif p_precision = 'sector' then
      v_b := private.bearing_deg((v_zone ->> 'lat')::double precision, (v_zone ->> 'lng')::double precision, e.lat, e.lng);
      v_d := private.dist_m((v_zone ->> 'lat')::double precision, (v_zone ->> 'lng')::double precision, e.lat, e.lng);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'sector', (floor(mod((v_b + 22.5)::numeric, 360) / 45))::integer,
        'ring', case when v_d < (v_zone ->> 'radius_m')::double precision / 2 then 0 else 1 end));
    else
      -- Zone : cercle de rayon r contenant la cible, centre décalé au hasard.
      v_r := greatest(100, (v_zone ->> 'radius_m')::double precision / 4);
      v_off := random() * v_r * 0.7;
      v_ang := random() * 2 * pi();
      v_out := v_out || jsonb_build_array(
        private.offset_point(e.lat, e.lng, v_off * sin(v_ang), -v_off * cos(v_ang)) || jsonb_build_object('r_m', round(v_r)));
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function private.radar_pulse_gps(p_game uuid, p_team text, p_kind text, p_by uuid, p_olat double precision, p_olng double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_precision text;
  v_expires timestamptz;
  v_payload jsonb;
begin
  update public.games set radar_pulse_count = radar_pulse_count + 1 where id = p_game returning * into v_g;
  v_precision := v_g.config -> 'radar' ->> 'precision';
  if v_precision = 'direction' and p_olat is null then v_precision := 'sector'; end if;
  v_expires := v_now + make_interval(secs => (v_g.config -> 'radar' ->> 'reveal_s')::integer);
  v_payload := jsonb_build_object(
    'i', v_g.radar_pulse_count, 'kind', p_kind, 'precision', v_precision,
    'contacts', private.radar_contacts_gps(p_game, p_team, v_precision, p_olat, p_olng),
    'origin', case when p_olat is null then null else jsonb_build_object('lat', round(p_olat::numeric, 5), 'lng', round(p_olng::numeric, 5)) end,
    'by', p_by, 'at', private.ms(v_now), 'expires_at', private.ms(v_expires));
  insert into public.radar_pulses (game_id, team, pulse_index, kind, precision, triggered_by, payload, created_at, expires_at)
  values (p_game, p_team, v_g.radar_pulse_count, p_kind, v_precision, p_by, v_payload, v_now, v_expires);
  perform private.emit(p_game, p_team, 'radar', v_payload);
  perform private.emit(p_game, private.enemy_of(p_team), 'radar_ping', jsonb_build_object('kind', p_kind, 'at', private.ms(v_now)));
  return v_payload;
end;
$$;

-- Barycentre des positions fraîches d'une équipe.
create or replace function private.team_centroid(p_game uuid, p_team text)
returns table (lat double precision, lng double precision)
language sql stable security definer set search_path = ''
as $$
  select avg(pp.lat), avg(pp.lng)
    from public.player_states ps
    join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
   where ps.game_id = p_game and ps.team = p_team and ps.status = 'active'
     and pp.received_at >= private.now_() - interval '2 minutes'
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
  v_lat double precision; v_lng double precision;
  p record;
begin
  select * into v_g from public.games where id = p_game;
  if (v_g.config -> 'radar' ->> 'enabled')::boolean and v_g.config -> 'radar' ->> 'mode' = 'auto' then
    v_teams := case v_g.config -> 'radar' ->> 'teams' when 'both' then array['hunter', 'fugitive']
                                                      else array[v_g.config -> 'radar' ->> 'teams'] end;
    foreach v_team in array v_teams loop
      select c.lat, c.lng into v_lat, v_lng from private.team_centroid(p_game, v_team) c;
      perform private.radar_pulse_gps(p_game, v_team, 'auto', null, v_lat, v_lng);
    end loop;
  end if;
  -- Mode de révélation périodique : les deux équipes reçoivent les positions
  -- approximatives adverses à chaque impulsion.
  if v_g.config ->> 'enemy_reveal' = 'pulse' then
    for p in select user_id from public.player_states where game_id = p_game and status = 'active' loop
      perform private.broadcast_enemy(p_game, p.user_id);
    end loop;
  end if;
end;
$$;

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
  v_pos private.player_positions%rowtype;
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
  if not (v_radar ->> 'enabled')::boolean or v_radar ->> 'mode' <> 'manual' then perform private.fail('E_RADAR_UNAVAILABLE'); end if;
  if v_radar ->> 'teams' not in ('both', v_ps.team) then perform private.fail('E_WRONG_TEAM'); end if;
  v_pos := private.fresh_position(p_game, v_ps.user_id, (v_g.config ->> 'stale_after_s')::integer);
  if v_pos.game_id is null then perform private.fail('E_POSITION_REQUIRED'); end if;

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
     set team_state = jsonb_set(team_state, array[v_ps.team], jsonb_build_object('radar_last', private.ms(v_now), 'radar_uses', v_uses + 1))
   where id = p_game;
  v_payload := private.radar_pulse_gps(p_game, v_ps.team, 'manual', v_ps.user_id, v_pos.lat, v_pos.lng);
  perform private.count_usage(1, 0, 0);
  return v_payload || jsonb_build_object('uses', v_uses + 1);
end;
$$;

-- -----------------------------------------------------------------------------
-- Tick : échéances + sortie de zone + révélation périodique
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

  for r in
    update public.player_states set connected = false
     where game_id = p_game and status = 'active' and connected and last_seen_at < v_now - interval '45 seconds'
     returning user_id
  loop
    perform private.emit(p_game, 'all', 'player_status', jsonb_build_object('u', r.user_id, 'status', 'active', 'connected', false));
  end loop;

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
             then 'fugitive' else 'hunter' end, 'time_up');
      return;
    end if;

    -- Fugitif hors zone au-delà du délai de grâce : éliminé.
    for r in
      update public.player_states
         set status = 'captured', captured_at = v_now, captured_by = null
       where game_id = p_game and team = 'fugitive' and status = 'active' and out_of_zone_since is not null
         and out_of_zone_since < v_now - make_interval(secs => (v_g.config ->> 'out_of_zone_grace_s')::integer)
       returning user_id
    loop
      perform private.emit(p_game, 'all', 'capture', jsonb_build_object('f', r.user_id, 'reason', 'out_of_zone'));
    end loop;

    if v_g.next_radar_at is not null and v_now >= v_g.next_radar_at then
      v_interval := (v_g.config -> 'radar' ->> 'interval_s')::integer;
      update public.games
         set next_radar_at = next_radar_at + make_interval(secs =>
               v_interval * (floor(extract(epoch from (v_now - next_radar_at)) / v_interval) + 1))
       where id = p_game;
      perform private.auto_radar(p_game);
      perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
    end if;

    perform private.check_victory(p_game);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Capture GPS : distance réelle, positions fraîches et précises.
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
  v_me private.player_positions%rowtype;
  v_cfg jsonb;
  v_cd interval;
  v_fresh integer := 20;
  v_captured uuid[] := '{}';
  f record;
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('capture', 3, 1000);
  perform private.tick(p_game);

  select * into v_g from public.games where id = p_game for update;
  select * into v_ps from public.player_states where game_id = p_game and user_id = auth.uid() for update;
  v_cfg := v_g.config;
  if v_g.phase <> 'running' then perform private.fail('E_CANNOT_CAPTURE_NOW'); end if;
  if v_ps.team <> 'hunter' then perform private.fail('E_WRONG_TEAM'); end if;
  if v_ps.status <> 'active' then perform private.fail('E_NOT_ACTIVE'); end if;
  if v_ps.out_of_zone_since is not null then perform private.fail('E_OUT_OF_ZONE'); end if;

  v_cd := make_interval(secs => (v_cfg ->> 'capture_cooldown_s')::integer);
  if v_ps.last_capture_at is not null and v_ps.last_capture_at + v_cd > v_now then
    perform private.fail('E_COOLDOWN', private.ms(v_ps.last_capture_at + v_cd)::text);
  end if;
  v_me := private.fresh_position(p_game, v_ps.user_id, v_fresh);
  if v_me.game_id is null then perform private.fail('E_POSITION_REQUIRED'); end if;
  if v_me.accuracy_m > (v_cfg ->> 'max_accuracy_m')::real then perform private.fail('E_GPS_IMPRECISE', round(v_me.accuracy_m)::text); end if;

  update public.player_states set last_capture_at = v_now, last_seen_at = v_now, connected = true
   where game_id = p_game and user_id = v_ps.user_id;

  for f in
    select ps.user_id, pp.lat, pp.lng
      from public.player_states ps
      join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
     where ps.game_id = p_game and ps.team = 'fugitive' and ps.status = 'active'
       and pp.received_at >= v_now - make_interval(secs => v_fresh)
       and pp.accuracy_m <= (v_cfg ->> 'max_accuracy_m')::real
       and private.dist_m(v_me.lat, v_me.lng, pp.lat, pp.lng) <= (v_cfg ->> 'capture_radius_m')::double precision
     for update of ps
  loop
    if v_g.mode = 'infection' then
      update public.player_states set team = 'hunter', captured_at = v_now, captured_by = v_ps.user_id,
             ghost_until = null, jam_until = null, decoy_until = null, enemy_view = null
       where game_id = p_game and user_id = f.user_id;
    else
      update public.player_states set status = 'captured', captured_at = v_now, captured_by = v_ps.user_id,
             ghost_until = null, jam_until = null, decoy_until = null
       where game_id = p_game and user_id = f.user_id;
    end if;
    update public.player_states set captures = captures + 1 where game_id = p_game and user_id = v_ps.user_id;
    v_captured := v_captured || f.user_id;
    perform private.emit(p_game, 'all', 'capture', jsonb_build_object('h', v_ps.user_id, 'f', f.user_id, 'infected', v_g.mode = 'infection'));
    if v_g.mode = 'infection' then
      perform private.emit(p_game, 'p:' || f.user_id::text, 'team_changed', jsonb_build_object('team', 'hunter'));
    end if;
  end loop;

  if array_length(v_captured, 1) is null then
    perform private.emit(p_game, 'p:' || v_ps.user_id::text, 'capture_missed', '{}'::jsonb);
  end if;
  perform private.check_victory(p_game);
  perform private.count_usage(1, 0, 0);
  return jsonb_build_object('captured', to_jsonb(v_captured), 'cooldown_until', private.ms(v_now + v_cd), 'server_now', private.ms(v_now));
end;
$$;

-- -----------------------------------------------------------------------------
-- Capacités GPS
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
  v_me private.player_positions%rowtype;
  v_cfg jsonb;
  v_dur integer; v_cd integer; v_max integer;
  v_last timestamptz; v_uses integer; v_until timestamptz;
  v_result jsonb := '{}'::jsonb;
  v_radius double precision; v_factor double precision; v_ang double precision; v_off double precision;
  v_contacts jsonb; v_count integer;
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

  if p_key in ('scan', 'tracker', 'sonar') then
    v_me := private.fresh_position(p_game, v_ps.user_id, (v_g.config ->> 'stale_after_s')::integer);
    if v_me.game_id is null then perform private.fail('E_POSITION_REQUIRED'); end if;
  end if;

  case p_key
    when 'ghost' then
      update public.player_states set ghost_until = v_until where game_id = p_game and user_id = v_ps.user_id;
    when 'jammer' then
      update public.player_states set jam_until = v_until where game_id = p_game and user_id = v_ps.user_id;
    when 'decoy' then
      v_off := coalesce((v_ab.params ->> 'offset_m')::double precision, 150);
      v_ang := random() * 2 * pi();
      update public.player_states
         set decoy_until = v_until, decoy_east_m = v_off * sin(v_ang), decoy_south_m = -v_off * cos(v_ang)
       where game_id = p_game and user_id = v_ps.user_id;
    when 'scan' then
      v_radius := coalesce((v_ab.params ->> 'radius_m')::double precision, 250);
      v_factor := coalesce((v_ab.params ->> 'factor')::double precision, 3);
      select coalesce(jsonb_agg(
               private.snap(v_g.config -> 'zone', pp.lat, pp.lng,
                            greatest(10, (v_g.config ->> 'approx_m')::double precision / v_factor, pp.accuracy_m))
               || jsonb_build_object('u', ps.user_id,
                                     'acc', round(greatest(10, (v_g.config ->> 'approx_m')::double precision / v_factor, pp.accuracy_m)))), '[]'::jsonb)
        into v_contacts
        from public.player_states ps
        join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
       where ps.game_id = p_game and ps.team = 'fugitive' and ps.status = 'active'
         and pp.received_at >= v_now - make_interval(secs => (v_g.config ->> 'stale_after_s')::integer)
         and private.dist_m(v_me.lat, v_me.lng, pp.lat, pp.lng) <= v_radius;
      v_result := jsonb_build_object('center', jsonb_build_object('lat', round(v_me.lat::numeric, 5), 'lng', round(v_me.lng::numeric, 5)),
                                     'radius_m', v_radius, 'contacts', v_contacts, 'expires_at', private.ms(v_until));
      perform private.emit(p_game, 'hunter', 'reveal', v_result || jsonb_build_object('by', v_ps.user_id));
      for n in select (c ->> 'u')::uuid u from jsonb_array_elements(v_contacts) c loop
        perform private.emit(p_game, 'p:' || n.u::text, 'alert', jsonb_build_object('kind', 'scanned'));
      end loop;
    when 'tracker' then
      select ps.user_id, ps.jam_until, pp.lat, pp.lng into n
        from public.player_states ps
        join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
       where ps.game_id = p_game and ps.team = 'fugitive' and ps.status = 'active'
         and pp.received_at >= v_now - make_interval(secs => (v_g.config ->> 'stale_after_s')::integer)
       order by private.dist_m(v_me.lat, v_me.lng, pp.lat, pp.lng)
       limit 1;
      if not found then
        v_result := jsonb_build_object('none', true);
      elsif n.jam_until is not null and n.jam_until > v_now then
        v_result := jsonb_build_object('jammed', true);
      else
        v_result := jsonb_build_object(
          'dir', private.dir8(private.bearing_deg(v_me.lat, v_me.lng, n.lat, n.lng)),
          'band', private.gps_band(private.dist_m(v_me.lat, v_me.lng, n.lat, n.lng)),
          'dist_m', (round(private.dist_m(v_me.lat, v_me.lng, n.lat, n.lng) / 50) * 50)::integer);
      end if;
      v_result := v_result || jsonb_build_object('origin', jsonb_build_object('lat', round(v_me.lat::numeric, 5), 'lng', round(v_me.lng::numeric, 5)));
      perform private.emit(p_game, 'hunter', 'tracker', v_result || jsonb_build_object('by', v_ps.user_id));
    when 'sonar' then
      v_radius := coalesce((v_ab.params ->> 'radius_m')::double precision, 150);
      select count(*) into v_count
        from public.player_states ps
        join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
       where ps.game_id = p_game and ps.team = 'fugitive' and ps.status = 'active'
         and pp.received_at >= v_now - make_interval(secs => (v_g.config ->> 'stale_after_s')::integer)
         and private.dist_m(v_me.lat, v_me.lng, pp.lat, pp.lng) <= v_radius;
      v_result := jsonb_build_object('count', v_count, 'radius_m', v_radius);
      perform private.emit(p_game, 'hunter', 'sonar', v_result || jsonb_build_object('by', v_ps.user_id));
    else
      perform private.fail('E_UNKNOWN_ABILITY');
  end case;

  insert into public.ability_usage (game_id, user_id, team, ability_key, used_at, expires_at, target, result)
  values (p_game, v_ps.user_id, v_ps.team, p_key, v_now, case when v_dur > 0 then v_until end, p_target, v_result);
  update public.player_states set abilities_used = abilities_used + 1, last_seen_at = v_now, connected = true
   where game_id = p_game and user_id = v_ps.user_id;
  perform private.emit(p_game, v_ps.team, 'ability',
    jsonb_build_object('u', v_ps.user_id, 'key', p_key, 'until', case when v_dur > 0 then private.ms(v_until) end));

  -- Les effets de discrétion s'appliquent immédiatement aux adversaires.
  if p_key in ('ghost', 'jammer', 'decoy') then
    perform private.broadcast_enemy(p_game, v_ps.user_id);
  end if;

  perform private.count_usage(1, 0, 0);
  return jsonb_build_object('key', p_key, 'used_at', private.ms(v_now),
                            'until', case when v_dur > 0 then private.ms(v_until) end,
                            'cooldown_until', private.ms(v_now + make_interval(secs => v_cd)),
                            'uses', v_uses + 1, 'result', v_result, 'server_now', private.ms(v_now));
end;
$$;

-- -----------------------------------------------------------------------------
-- Arrêt de sécurité et départ : fin immédiate du partage + effacement.
-- -----------------------------------------------------------------------------
create or replace function private.erase_positions(p_game uuid, p_user uuid)
returns void language sql security definer set search_path = ''
as $$
  delete from private.player_positions where game_id = p_game and user_id = p_user;
  delete from private.position_history where game_id = p_game and user_id = p_user;
$$;

create or replace function public.safety_stop(p_game uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ps public.player_states%rowtype := private.require_participant(p_game);
begin
  perform private.abandon_player(p_game, v_ps.user_id, 'safety');
  update public.player_states set enemy_view = null, last_pos_at = null where game_id = p_game and user_id = v_ps.user_id;
  perform private.erase_positions(p_game, v_ps.user_id);
  perform private.emit(p_game, 'all', 'position_withdrawn', jsonb_build_object('u', v_ps.user_id));
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
  perform private.erase_positions(p_game, auth.uid());
  perform private.emit(p_game, 'all', 'position_withdrawn', jsonb_build_object('u', auth.uid()));
end;
$$;

-- -----------------------------------------------------------------------------
-- Vue de partie (resynchronisation) — positions arrondies uniquement.
-- -----------------------------------------------------------------------------
create or replace function private.game_view_base(p_game uuid)
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
  v_mypos private.player_positions%rowtype;
begin
  perform private.rate_limit('game_view', 20, 10000);
  perform private.tick(p_game);
  select * into v_g from public.games where id = p_game;
  select * into v_me from public.player_states where game_id = p_game and user_id = v_me.user_id;
  select * into v_room from public.rooms where id = v_g.room_id;
  select * into v_mypos from private.player_positions where game_id = p_game and user_id = v_me.user_id;
  v_finished := v_g.phase = 'finished';
  perform private.count_usage(1, 0, 0);

  return jsonb_build_object(
    'server_now', private.ms(v_now),
    'game', jsonb_build_object(
      'id', v_g.id, 'room_id', v_g.room_id, 'mode', v_g.mode, 'phase', v_g.phase, 'config', v_g.config,
      'zone', v_g.config -> 'zone',
      'started_at', private.ms(v_g.started_at),
      'running_at', private.ms(v_g.running_at),
      'phase_started_at', private.ms(v_g.phase_started_at),
      'phase_ends_at', private.ms(v_g.phase_ends_at),
      'paused_from', v_g.paused_from, 'paused_remaining_ms', v_g.paused_remaining_ms,
      'next_radar_at', private.ms(v_g.next_radar_at),
      'ended_at', private.ms(v_g.ended_at),
      'winner', v_g.winner, 'end_reason', v_g.end_reason,
      'radar_state', coalesce(v_g.team_state -> v_me.team, '{}'::jsonb)),
    'room', jsonb_build_object('id', v_room.id, 'code', v_room.code, 'name', v_room.name, 'host_id', v_room.host_id),
    'me', jsonb_build_object(
      'u', v_me.user_id, 'team', v_me.team, 'initial_team', v_me.initial_team, 'status', v_me.status,
      'lat', v_mypos.lat, 'lng', v_mypos.lng, 'acc', v_mypos.accuracy_m, 'pos_at', private.ms(v_mypos.received_at),
      'out_of_zone_since', private.ms(v_me.out_of_zone_since),
      'ghost_until', private.ms(v_me.ghost_until), 'jam_until', private.ms(v_me.jam_until),
      'decoy_until', private.ms(v_me.decoy_until),
      'last_capture_at', private.ms(v_me.last_capture_at), 'captures', v_me.captures, 'distance_m', v_me.distance),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'u', ps.user_id, 'username', p.username, 'avatar', p.avatar, 'team', ps.team,
               'status', ps.status, 'connected', ps.connected, 'captures', ps.captures,
               'out_of_zone', ps.out_of_zone_since is not null) order by ps.team, p.username), '[]'::jsonb)
        from public.player_states ps join public.profiles p on p.id = ps.user_id
       where ps.game_id = p_game),
    -- Coéquipiers : arrondi 10 m.
    'allies', (
      select coalesce(jsonb_agg(private.snap(v_g.config -> 'zone', pp.lat, pp.lng, 10)
               || jsonb_build_object('u', ps.user_id, 'acc', round(greatest(pp.accuracy_m, 10)), 'at', private.ms(pp.received_at))), '[]'::jsonb)
        from public.player_states ps
        join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
       where ps.game_id = p_game and ps.team = v_me.team and ps.user_id <> v_me.user_id and ps.status = 'active'),
    -- Adversaires : dernière position approximative diffusée.
    'enemies', (
      select coalesce(jsonb_agg(ps.enemy_view), '[]'::jsonb)
        from public.player_states ps
       where ps.game_id = p_game and ps.team <> v_me.team and ps.status = 'active' and ps.enemy_view is not null),
    'cooldowns', (
      select coalesce(jsonb_object_agg(k.ability_key, jsonb_build_object(
               'last_used_at', private.ms(k.last_used), 'uses', k.uses, 'until', private.ms(k.until))), '{}'::jsonb)
        from (select ability_key, max(used_at) last_used, count(*) uses, max(expires_at) until
                from public.ability_usage where game_id = p_game and user_id = v_me.user_id group by ability_key) k),
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
               where ev.game_id = p_game and ev.type not in ('pos', 'enemy_pos')
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
revoke execute on function private.game_view_base(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Rétention : positions brutes effacées 24 h après la fin de partie.
-- -----------------------------------------------------------------------------
create or replace function private.cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events integer; v_rooms integer; v_games integer; v_positions integer;
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
   where e.game_id = g.id and g.phase = 'finished' and g.ended_at < private.now_() - interval '30 days';
  get diagnostics v_events = row_count;

  update public.rooms set status = 'closed'
   where status <> 'closed' and last_activity_at < private.now_() - interval '7 days';
  get diagnostics v_rooms = row_count;
  delete from private.rate_limits where window_start < private.now_() - interval '1 day';
  return jsonb_build_object('games_closed', v_games, 'positions_deleted', v_positions,
                            'events_deleted', v_events, 'rooms_closed', v_rooms);
end;
$$;

-- -----------------------------------------------------------------------------
-- Suppression des fonctions propres à la grille virtuelle (remplacées).
--   move               -> report_position
--   compute_vis        -> enemy_payload / broadcast_enemy
--   available_steps    -> sans objet (déplacement physique)
--   generate_map, map_dims, cell, open_cells -> zone réelle
--   radar_contacts, radar_pulse -> radar_contacts_gps, radar_pulse_gps
-- -----------------------------------------------------------------------------
drop function if exists public.move(uuid, jsonb);
drop function if exists private.compute_vis(uuid, text);
drop function if exists private.available_steps(public.player_states, jsonb, timestamptz);
drop function if exists private.generate_map(text, numeric, boolean, bigint);
drop function if exists private.map_dims(text);
drop function if exists private.open_cells(jsonb);
drop function if exists private.cell(jsonb, integer, integer);
drop function if exists private.radar_contacts(uuid, text, text, integer, integer);
drop function if exists private.radar_pulse(uuid, text, text, uuid, integer, integer);

-- -----------------------------------------------------------------------------
-- Privilèges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.is_room_member(uuid, uuid), private.my_team(uuid), private.is_participant(uuid),
  private.game_finished(uuid), private.is_room_host(uuid), private.can_see_game(uuid),
  private.can_access_topic(text, text, boolean), private.team_topic(uuid, text)
  to authenticated;
revoke execute on function public.report_position(uuid, double precision, double precision, real, bigint, real, real),
  public.safety_stop(uuid), public.set_location_consent(uuid, boolean), public.leave_game(uuid),
  public.attempt_capture(uuid), public.use_ability(uuid, text, jsonb), public.radar_activate(uuid),
  public.start_game(uuid), public.get_room_state(uuid) from public, anon;
grant execute on function public.report_position(uuid, double precision, double precision, real, bigint, real, real),
  public.safety_stop(uuid), public.set_location_consent(uuid, boolean), public.leave_game(uuid),
  public.attempt_capture(uuid), public.use_ability(uuid, text, jsonb), public.radar_activate(uuid),
  public.start_game(uuid), public.get_room_state(uuid) to authenticated;
