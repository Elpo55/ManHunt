-- =============================================================================
-- 1010 — Modes Royale et Mister X, zones avancées, objectifs, capture QR,
--         GPS muet (v0.4.0)
--
-- Toute la logique est calculée et validée ici (serveur autoritaire) :
-- réduction de zone, révélations de Mister X, balises et extraction,
-- jetons de capture à usage unique, détection du GPS muet.
-- Parité stricte de normalize_config avec packages/shared/src/config.ts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schéma
-- -----------------------------------------------------------------------------
alter table public.games drop constraint if exists games_mode_check;
alter table public.games add constraint games_mode_check check (mode in ('classic', 'infection', 'royale', 'misterx'));
alter table public.games drop constraint if exists games_end_reason_check;
alter table public.games add constraint games_end_reason_check check (end_reason is null or end_reason in
  ('all_captured', 'time_up', 'hunters_left', 'fugitives_left', 'aborted', 'no_players', 'objectives'));

alter table public.games
  add column if not exists zone_current jsonb,
  add column if not exists zone_next jsonb,
  add column if not exists zone_next_at timestamptz,
  add column if not exists zone_stage integer not null default 0,
  add column if not exists misterx_next_at timestamptz,
  add column if not exists misterx_last jsonb,
  add column if not exists extraction_opened boolean not null default false,
  add column if not exists hunter_epoch integer not null default 0,
  add column if not exists sos jsonb;

alter table public.player_states
  add column if not exists objectives integer not null default 0,
  add column if not exists extracted_at timestamptz,
  add column if not exists gps_silent_since timestamptz,
  add column if not exists battery smallint,
  add column if not exists app_state text,
  add column if not exists gps_state text,
  add column if not exists health_at timestamptz;
alter table public.player_states drop constraint if exists player_states_battery_check;
alter table public.player_states add constraint player_states_battery_check check (battery is null or battery between 0 and 100);

alter table public.game_statistics
  add column if not exists objectives integer not null default 0,
  add column if not exists extracted boolean not null default false;

-- Balises et point d'extraction d'une partie (points choisis par l'hôte : lieux publics).
create table if not exists public.game_objectives (
  game_id    uuid not null references public.games (id) on delete cascade,
  idx        integer not null,
  kind       text not null,
  lat        double precision not null,
  lng        double precision not null,
  label      text not null,
  radius_m   integer not null,
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  primary key (game_id, idx),
  constraint game_objectives_kind_check check (kind in ('beacon', 'extraction'))
);
alter table public.game_objectives enable row level security;
revoke all on public.game_objectives from anon, authenticated, public;
grant select on public.game_objectives to authenticated;
drop policy if exists game_objectives_read on public.game_objectives;
create policy game_objectives_read on public.game_objectives for select to authenticated
  using (private.is_participant(game_id));

-- Jetons de capture QR / code : jamais lisibles par les clients.
create table if not exists private.capture_tokens (
  token_hash text primary key,
  short_code text not null,
  game_id    uuid not null references public.games (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid
);
create index if not exists capture_tokens_code_idx on private.capture_tokens (game_id, short_code);
alter table private.capture_tokens enable row level security;
revoke all on private.capture_tokens from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Normalisation (miroir exact de config.ts)
-- -----------------------------------------------------------------------------
create or replace function private.clean_label(p jsonb, p_key text, p_max integer, p_default text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := left(btrim(regexp_replace(
    coalesce(case when jsonb_typeof(p -> p_key) = 'string' then p ->> p_key end, ''), '[<>"[:cntrl:]]', '', 'g')), p_max);
begin
  return case when v = '' then p_default else v end;
end;
$$;

create or replace function private.is_num(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(v) = 'number', false);
$$;

-- Liste de points {lat, lng} (6 décimales), éléments invalides ignorés.
create or replace function private.normalize_points(p jsonb, p_max integer)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  e jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return v_out; end if;
  for e in select value from jsonb_array_elements(p) loop
    exit when jsonb_array_length(v_out) >= p_max;
    continue when coalesce(jsonb_typeof(e), '') <> 'object' or not private.is_num(e -> 'lat') or not private.is_num(e -> 'lng');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'lat', private.cfg_num6(e, 'lat', 0, -85, 85), 'lng', private.cfg_num6(e, 'lng', 0, -180, 180)));
  end loop;
  return v_out;
end;
$$;

create or replace function private.normalize_forbidden(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  e jsonb;
  v_pts jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return v_out; end if;
  for e in select value from jsonb_array_elements(p) loop
    exit when jsonb_array_length(v_out) >= 10;
    continue when coalesce(jsonb_typeof(e), '') <> 'object';
    if e ->> 'kind' = 'polygon' then
      v_pts := private.normalize_points(e -> 'points', 20);
      continue when jsonb_array_length(v_pts) < 3;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'polygon', 'points', v_pts,
        'label', private.clean_label(e, 'label', 40, 'Zone interdite')));
    else
      continue when not private.is_num(e -> 'lat') or not private.is_num(e -> 'lng');
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'circle',
        'lat', private.cfg_num6(e, 'lat', 0, -85, 85), 'lng', private.cfg_num6(e, 'lng', 0, -180, 180),
        'radius_m', private.cfg_int(e, 'radius_m', 50, 10, 1000),
        'label', private.clean_label(e, 'label', 40, 'Zone interdite')));
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function private.normalize_place(p jsonb, p_default_label text)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then p := '{}'::jsonb; end if;
  return jsonb_build_object(
    'set', private.cfg_bool(p, 'set', false) and private.is_num(p -> 'lat') and private.is_num(p -> 'lng'),
    'lat', private.cfg_num6(p, 'lat', 0, -85, 85),
    'lng', private.cfg_num6(p, 'lng', 0, -180, 180),
    'label', private.clean_label(p, 'label', 40, p_default_label));
end;
$$;

create or replace function private.normalize_zone(z jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_label text;
  v_poly jsonb;
begin
  if z is null or jsonb_typeof(z) <> 'object' then
    z := '{}'::jsonb;
  end if;
  v_label := left(btrim(regexp_replace(
    coalesce(case when jsonb_typeof(z -> 'label') = 'string' then z ->> 'label' end, ''),
    '[<>"[:cntrl:]]', '', 'g')), 80);
  v_poly := private.normalize_points(z -> 'polygon', 20);
  return jsonb_build_object(
    'lat',       private.cfg_num6(z, 'lat', 48.8556, -85, 85),
    'lng',       private.cfg_num6(z, 'lng', 2.347, -180, 180),
    'radius_m',  private.cfg_int(z, 'radius_m', 500, 150, 3000),
    'label',     case when v_label = '' then 'Zone non définie' else v_label end,
    'set',       private.cfg_bool(z, 'set', false),
    'shape',     case when z ->> 'shape' = 'polygon' and jsonb_array_length(v_poly) >= 3 then 'polygon' else 'circle' end,
    'polygon',   case when z ->> 'shape' = 'polygon' and jsonb_array_length(v_poly) >= 3 then v_poly else '[]'::jsonb end,
    'forbidden', private.normalize_forbidden(z -> 'forbidden')
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
  ro jsonb := coalesce(c -> 'royale', '{}'::jsonb);
  mx jsonb := coalesce(c -> 'misterx', '{}'::jsonb);
  ob jsonb := coalesce(c -> 'objectives', '{}'::jsonb);
  sp jsonb := coalesce(c -> 'spectators', '{}'::jsonb);
  rp jsonb := coalesce(c -> 'replay', '{}'::jsonb);
  out_abilities jsonb := '{}'::jsonb;
  v_beacons jsonb := '[]'::jsonb;
  e jsonb;
  i integer := 0;
  a record;
  ac jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then c := '{}'::jsonb; end if;
  if jsonb_typeof(r) <> 'object' then r := '{}'::jsonb; end if;
  if jsonb_typeof(ab) <> 'object' then ab := '{}'::jsonb; end if;
  if jsonb_typeof(ro) <> 'object' then ro := '{}'::jsonb; end if;
  if jsonb_typeof(mx) <> 'object' then mx := '{}'::jsonb; end if;
  if jsonb_typeof(ob) <> 'object' then ob := '{}'::jsonb; end if;
  if jsonb_typeof(sp) <> 'object' then sp := '{}'::jsonb; end if;
  if jsonb_typeof(rp) <> 'object' then rp := '{}'::jsonb; end if;

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

  if jsonb_typeof(ob -> 'beacons') = 'array' then
    for e in select value from jsonb_array_elements(ob -> 'beacons') loop
      exit when jsonb_array_length(v_beacons) >= 10;
      continue when coalesce(jsonb_typeof(e), '') <> 'object' or not private.is_num(e -> 'lat') or not private.is_num(e -> 'lng');
      i := i + 1;
      v_beacons := v_beacons || jsonb_build_array(jsonb_build_object(
        'lat', private.cfg_num6(e, 'lat', 0, -85, 85), 'lng', private.cfg_num6(e, 'lng', 0, -180, 180),
        'label', private.clean_label(e, 'label', 40, 'Balise ' || i)));
    end loop;
  end if;

  return jsonb_build_object(
    'mode',                private.cfg_enum(c, 'mode', 'classic', array['classic', 'infection', 'royale', 'misterx']),
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
    'capture_method',      private.cfg_enum(c, 'capture_method', 'both', array['gps', 'qr', 'both']),
    'max_accuracy_m',      private.cfg_int(c, 'max_accuracy_m', 35, 10, 100),
    'max_speed_mps',       private.cfg_int(c, 'max_speed_mps', 12, 3, 40),
    'out_of_zone_grace_s', private.cfg_int(c, 'out_of_zone_grace_s', 60, 15, 600),
    'disconnect_grace_s',  private.cfg_int(c, 'disconnect_grace_s', 180, 30, 900),
    'gps_silent_s',        private.cfg_int(c, 'gps_silent_s', 120, 60, 600),
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
    'royale', jsonb_build_object(
      'stages',      private.cfg_int(ro, 'stages', 3, 1, 6),
      'final_ratio', private.cfg_num(ro, 'final_ratio', 0.35, 0.2, 0.8),
      'warn_s',      private.cfg_int(ro, 'warn_s', 60, 30, 300)
    ),
    'misterx', jsonb_build_object(
      'reveal_interval_s', private.cfg_int(mx, 'reveal_interval_s', 180, 60, 900)
    ),
    'objectives', jsonb_build_object(
      'enabled',           private.cfg_bool(ob, 'enabled', false),
      'radius_m',          private.cfg_int(ob, 'radius_m', 25, 10, 100),
      'points_each',       private.cfg_int(ob, 'points_each', 100, 50, 500),
      'win_on_all',        private.cfg_bool(ob, 'win_on_all', false),
      'beacons',           v_beacons,
      'extraction',        private.normalize_place(ob -> 'extraction', 'Extraction'),
      'extraction_open_s', private.cfg_int(ob, 'extraction_open_s', 300, 60, 1800),
      'extraction_bonus',  private.cfg_int(ob, 'extraction_bonus', 300, 0, 1000)
    ),
    'spectators', jsonb_build_object(
      'enabled', private.cfg_bool(sp, 'enabled', true),
      'delay_s', private.cfg_int(sp, 'delay_s', 180, 60, 600)
    ),
    'replay', jsonb_build_object('enabled', private.cfg_bool(rp, 'enabled', true)),
    'rendezvous', private.normalize_place(c -> 'rendezvous', 'Point de rendez-vous'),
    'abilities', out_abilities
  );
end;
$$;

update public.rooms set config = private.normalize_config(config);

-- -----------------------------------------------------------------------------
-- Géométrie : polygones, distance aux bords, zone de jeu effective
-- -----------------------------------------------------------------------------
-- Point dans polygone (lancer de rayon). pts = [{lat, lng}, ...]
create or replace function private.in_polygon(p_lat double precision, p_lng double precision, pts jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  n integer := jsonb_array_length(pts);
  i integer;
  j integer;
  xi double precision; yi double precision; xj double precision; yj double precision;
  inside boolean := false;
begin
  if n < 3 then return false; end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    xi := (pts -> i ->> 'lng')::double precision; yi := (pts -> i ->> 'lat')::double precision;
    xj := (pts -> j ->> 'lng')::double precision; yj := (pts -> j ->> 'lat')::double precision;
    if ((yi > p_lat) <> (yj > p_lat)) and (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end;
$$;

-- Distance (m) du point au contour du polygone (projection locale).
create or replace function private.dist_to_polygon_m(p_lat double precision, p_lng double precision, pts jsonb)
returns double precision language plpgsql immutable set search_path = '' as $$
declare
  n integer := jsonb_array_length(pts);
  k double precision := 111320.0 * cos(radians(p_lat));
  best double precision := 'Infinity';
  i integer;
  ax double precision; ay double precision; bx double precision; by_ double precision;
  dx double precision; dy double precision; t double precision; d double precision;
begin
  for i in 0 .. n - 1 loop
    ax := ((pts -> i ->> 'lng')::double precision - p_lng) * k;
    ay := ((pts -> i ->> 'lat')::double precision - p_lat) * 111320.0;
    bx := ((pts -> ((i + 1) % n) ->> 'lng')::double precision - p_lng) * k;
    by_ := ((pts -> ((i + 1) % n) ->> 'lat')::double precision - p_lat) * 111320.0;
    dx := bx - ax; dy := by_ - ay;
    t := case when dx = 0 and dy = 0 then 0 else greatest(0, least(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) end;
    d := sqrt((ax + t * dx) ^ 2 + (ay + t * dy) ^ 2);
    if d < best then best := d; end if;
  end loop;
  return best;
end;
$$;

/**
 * Le point est-il hors de l'aire de jeu ? (zone courante — Royale —, cercle ou
 * polygone, zones interdites). Tolérance : la précision GPS (plafonnée à 50 m),
 * toujours en faveur du joueur.
 */
create or replace function private.outside_area(p_cfg jsonb, p_current jsonb, p_lat double precision, p_lng double precision, p_acc double precision)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  z jsonb := p_cfg -> 'zone';
  tol double precision := least(coalesce(p_acc, 0), 50);
  f jsonb;
begin
  if p_current is not null then
    if private.dist_m((p_current ->> 'lat')::double precision, (p_current ->> 'lng')::double precision, p_lat, p_lng)
       > (p_current ->> 'radius_m')::double precision + tol then return true; end if;
  elsif z ->> 'shape' = 'polygon' then
    if not private.in_polygon(p_lat, p_lng, z -> 'polygon') and private.dist_to_polygon_m(p_lat, p_lng, z -> 'polygon') > tol then
      return true;
    end if;
  elsif private.dist_m((z ->> 'lat')::double precision, (z ->> 'lng')::double precision, p_lat, p_lng)
        > (z ->> 'radius_m')::double precision + tol then
    return true;
  end if;
  for f in select value from jsonb_array_elements(coalesce(z -> 'forbidden', '[]'::jsonb)) loop
    if f ->> 'kind' = 'polygon' then
      if private.in_polygon(p_lat, p_lng, f -> 'points') and private.dist_to_polygon_m(p_lat, p_lng, f -> 'points') > tol then
        return true;
      end if;
    elsif private.dist_m((f ->> 'lat')::double precision, (f ->> 'lng')::double precision, p_lat, p_lng)
          < (f ->> 'radius_m')::double precision - tol then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Point de configuration (balise, extraction, repère) à l'intérieur de l'aire de jeu ?
create or replace function private.inside_area_strict(p_cfg jsonb, p_lat double precision, p_lng double precision)
returns boolean language sql immutable set search_path = '' as $$
  select not private.outside_area(p_cfg, null, p_lat, p_lng, 0);
$$;

-- -----------------------------------------------------------------------------
-- Royale : calcul de la prochaine zone (déterministe, contenue dans la précédente)
-- -----------------------------------------------------------------------------
create or replace function private.royale_zone(p_game uuid, p_stage integer, p_prev jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg jsonb;
  v_r0 double precision;
  v_s integer;
  v_f double precision;
  v_r double precision;
  v_max double precision;
  v_ang double precision;
  v_d double precision;
  v_c jsonb;
begin
  select config into v_cfg from public.games where id = p_game;
  v_r0 := (v_cfg -> 'zone' ->> 'radius_m')::double precision;
  v_s := (v_cfg -> 'royale' ->> 'stages')::integer;
  v_f := (v_cfg -> 'royale' ->> 'final_ratio')::double precision;
  v_r := round(v_r0 * (1 - (1 - v_f) * p_stage / v_s));
  v_max := greatest(0, (p_prev ->> 'radius_m')::double precision - v_r) * 0.8;
  v_ang := 2 * pi() * private.hash01(0, p_game::text || ':royale:a:' || p_stage);
  v_d := v_max * sqrt(private.hash01(0, p_game::text || ':royale:d:' || p_stage));
  v_c := private.offset_point((p_prev ->> 'lat')::double precision, (p_prev ->> 'lng')::double precision,
                              v_d * sin(v_ang), -v_d * cos(v_ang));
  return v_c || jsonb_build_object('radius_m', v_r::integer);
end;
$$;

-- Prochaine échéance Royale (étape k sur S, réparties sur la durée de jeu).
create or replace function private.royale_time(p_game uuid, p_stage integer)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select g.running_at + make_interval(secs => (g.config ->> 'duration_s')::double precision * p_stage
                                              / ((g.config -> 'royale' ->> 'stages')::integer + 1))
    from public.games g where g.id = p_game;
$$;

-- Recalcule l'état « hors zone » de tous les joueurs actifs (après réduction).
create or replace function private.recheck_zone(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  r record;
  v_out boolean;
begin
  select * into v_g from public.games where id = p_game;
  for r in
    select ps.user_id, ps.out_of_zone_since, pp.lat, pp.lng, pp.accuracy_m
      from public.player_states ps
      join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
     where ps.game_id = p_game and ps.status = 'active'
  loop
    v_out := private.outside_area(v_g.config, v_g.zone_current, r.lat, r.lng, r.accuracy_m);
    if v_out and r.out_of_zone_since is null then
      update public.player_states set out_of_zone_since = v_now where game_id = p_game and user_id = r.user_id;
      perform private.emit(p_game, 'all', 'zone_status', jsonb_build_object('u', r.user_id, 'out', true, 'at', private.ms(v_now)));
    elsif not v_out and r.out_of_zone_since is not null then
      update public.player_states set out_of_zone_since = null where game_id = p_game and user_id = r.user_id;
      perform private.emit(p_game, 'all', 'zone_status', jsonb_build_object('u', r.user_id, 'out', false, 'at', private.ms(v_now)));
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rotation des topics d'équipe : un joueur qui n'est plus actif (capturé,
-- parti) ou change d'équipe ne peut plus rejoindre le canal privé de son
-- ancienne équipe (spectateurs : pas d'informations privilégiées).
-- -----------------------------------------------------------------------------
create or replace function private.team_topic(p_game uuid, p_team text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'game:' || p_game::text || ':' || p_team ||
         case when p_team = 'fugitive' and g.fugitive_epoch > 0 then ':e' || g.fugitive_epoch
              when p_team = 'hunter' and g.hunter_epoch > 0 then ':e' || g.hunter_epoch
              else '' end
    from public.games g where g.id = p_game
$$;

create or replace function private.bump_fugitive_epoch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.team = 'fugitive' and new.team = 'hunter')
     or (old.team = 'fugitive' and old.status = 'active' and new.status <> 'active') then
    update public.games set fugitive_epoch = fugitive_epoch + 1 where id = new.game_id;
  elsif old.team = 'hunter' and old.status = 'active' and new.status <> 'active' then
    update public.games set hunter_epoch = hunter_epoch + 1 where id = new.game_id;
  end if;
  return new;
end;
$$;
drop trigger if exists player_states_team_epoch on public.player_states;
create trigger player_states_team_epoch
  after update of team, status on public.player_states
  for each row execute function private.bump_fugitive_epoch();

-- Topic d'équipe réservé aux joueurs ACTIFS de l'équipe (ou à tous après la partie).
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
  v_extra text := split_part(p_topic, ':', 5);
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null or p_topic is null or v_id !~ v_uuid_re or v_extra <> '' then
    return false;
  end if;
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
    if v_scope in ('hunter', 'fugitive') then
      return private.my_team(v_id::uuid) = v_scope
         and p_topic = private.team_topic(v_id::uuid, v_scope)
         and (private.game_finished(v_id::uuid)
              or exists (select 1 from public.player_states
                          where game_id = v_id::uuid and user_id = auth.uid() and status = 'active'));
    end if;
    if v_scope = 'p' and v_target = auth.uid()::text then
      return private.is_participant(v_id::uuid);
    end if;
  end if;
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Démarrage : règles propres à chaque mode, objectifs, fonctionnalités activées
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
  v_mode text;
  e jsonb;
  i integer := 0;
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
  v_mode := v_cfg ->> 'mode';
  if not (v_cfg -> 'zone' ->> 'set')::boolean then perform private.fail('E_ZONE_NOT_SET'); end if;
  if v_no_consent > 0 then perform private.fail('E_CONSENT_MISSING', v_no_consent::text); end if;

  -- Fonctionnalités désactivées par l'administration.
  if v_mode in ('royale', 'misterx') and not private.feature_on(v_mode) then perform private.fail('E_FEATURE_DISABLED', v_mode); end if;
  if (v_cfg -> 'objectives' ->> 'enabled')::boolean and not private.feature_on('objectives') then
    perform private.fail('E_FEATURE_DISABLED', 'objectives');
  end if;
  if v_cfg ->> 'capture_method' <> 'gps' and not private.feature_on('qr_capture') then
    v_cfg := jsonb_set(v_cfg, '{capture_method}', '"gps"');
  end if;
  -- Règles propres aux modes.
  if v_mode = 'misterx' and v_nf <> 1 then perform private.fail('E_MISTERX_ONE_FUGITIVE'); end if;
  if v_mode = 'royale' and v_cfg -> 'zone' ->> 'shape' <> 'circle' then perform private.fail('E_ROYALE_NEEDS_CIRCLE'); end if;
  if (v_cfg -> 'objectives' ->> 'enabled')::boolean then
    if jsonb_array_length(v_cfg -> 'objectives' -> 'beacons') = 0 and not (v_cfg -> 'objectives' -> 'extraction' ->> 'set')::boolean then
      perform private.fail('E_OBJECTIVES_EMPTY');
    end if;
    for e in select value from jsonb_array_elements(v_cfg -> 'objectives' -> 'beacons') loop
      if not private.inside_area_strict(v_cfg, (e ->> 'lat')::double precision, (e ->> 'lng')::double precision) then
        perform private.fail('E_OBJECTIVE_OUTSIDE', e ->> 'label');
      end if;
    end loop;
    if (v_cfg -> 'objectives' -> 'extraction' ->> 'set')::boolean
       and not private.inside_area_strict(v_cfg, (v_cfg -> 'objectives' -> 'extraction' ->> 'lat')::double precision,
                                                 (v_cfg -> 'objectives' -> 'extraction' ->> 'lng')::double precision) then
      perform private.fail('E_OBJECTIVE_OUTSIDE', 'extraction');
    end if;
  end if;
  v_prep := (v_cfg ->> 'prep_s')::integer;

  insert into public.games (room_id, mode, phase, config, map, seed, created_by, started_at,
                            phase_started_at, phase_ends_at, running_at, next_radar_at, zone_current)
  values (p_room, v_mode,
          case when v_prep > 0 then 'preparation' else 'running' end,
          v_cfg, jsonb_build_object('kind', 'gps', 'zone', v_cfg -> 'zone'), 0, auth.uid(), v_now, v_now,
          v_now + make_interval(secs => case when v_prep > 0 then v_prep else (v_cfg ->> 'duration_s')::integer end),
          case when v_prep > 0 then null else v_now end,
          case when v_prep = 0 and (((v_cfg -> 'radar' ->> 'enabled')::boolean and v_cfg -> 'radar' ->> 'mode' = 'auto')
                                    or v_cfg ->> 'enemy_reveal' = 'pulse')
               then v_now + make_interval(secs => (v_cfg -> 'radar' ->> 'interval_s')::integer) end,
          case when v_mode = 'royale' then jsonb_build_object('lat', v_cfg -> 'zone' -> 'lat', 'lng', v_cfg -> 'zone' -> 'lng',
                                                             'radius_m', v_cfg -> 'zone' -> 'radius_m') end)
  returning id into v_game_id;

  insert into public.player_states (game_id, user_id, team, initial_team, x, y, steps, steps_at, last_seen_at, joined_at)
  select v_game_id, m.user_id, m.team, m.team, null, null, 0, v_now, v_now, v_now
    from public.room_members m where m.room_id = p_room;

  if (v_cfg -> 'objectives' ->> 'enabled')::boolean then
    for e in select value from jsonb_array_elements(v_cfg -> 'objectives' -> 'beacons') loop
      i := i + 1;
      insert into public.game_objectives (game_id, idx, kind, lat, lng, label, radius_m)
      values (v_game_id, i, 'beacon', (e ->> 'lat')::double precision, (e ->> 'lng')::double precision, e ->> 'label',
              (v_cfg -> 'objectives' ->> 'radius_m')::integer);
    end loop;
    if (v_cfg -> 'objectives' -> 'extraction' ->> 'set')::boolean then
      insert into public.game_objectives (game_id, idx, kind, lat, lng, label, radius_m)
      values (v_game_id, 0, 'extraction', (v_cfg -> 'objectives' -> 'extraction' ->> 'lat')::double precision,
              (v_cfg -> 'objectives' -> 'extraction' ->> 'lng')::double precision,
              v_cfg -> 'objectives' -> 'extraction' ->> 'label', (v_cfg -> 'objectives' ->> 'radius_m')::integer);
    end if;
  end if;

  update public.rooms set status = 'playing', current_game_id = v_game_id where id = p_room;
  update public.room_members set is_ready = false where room_id = p_room;

  if v_prep = 0 then perform private.schedule_mode(v_game_id); end if;
  perform private.emit(v_game_id, 'all', 'phase_changed', private.phase_payload(v_game_id));
  perform private.room_emit(p_room, 'game_started', jsonb_build_object('game_id', v_game_id));
  perform private.count_usage(1, 0, 0);
  return jsonb_build_object('game_id', v_game_id);
end;
$$;

-- Échéances propres au mode, posées au début de la phase de jeu.
create or replace function private.schedule_mode(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
begin
  select * into v_g from public.games where id = p_game for update;
  if v_g.mode = 'royale' then
    update public.games set zone_stage = 0,
           zone_next = private.royale_zone(p_game, 1, v_g.zone_current),
           zone_next_at = private.royale_time(p_game, 1)
     where id = p_game;
    perform private.emit(p_game, 'all', 'zone_next', private.zone_payload(p_game));
  elsif v_g.mode = 'misterx' then
    update public.games set misterx_next_at = private.now_() + make_interval(secs => (v_g.config -> 'misterx' ->> 'reveal_interval_s')::integer)
     where id = p_game;
  end if;
end;
$$;

create or replace function private.zone_payload(p_game uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('current', g.zone_current, 'next', g.zone_next, 'next_at', private.ms(g.zone_next_at),
                            'stage', g.zone_stage, 'stages', (g.config -> 'royale' ->> 'stages')::integer,
                            'warn_s', (g.config -> 'royale' ->> 'warn_s')::integer)
    from public.games g where g.id = p_game;
$$;

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
  perform private.schedule_mode(p_game);
  perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
end;
$$;

-- Reprise : échéances Royale et Mister X décalées de la durée de la pause ;
-- impossible tant qu'une alerte SOS n'est pas levée.
create or replace function private.do_resume(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_delta interval;
begin
  select * into v_g from public.games where id = p_game for update;
  if v_g.phase <> 'paused' then perform private.fail('E_INVALID_TRANSITION'); end if;
  if v_g.sos is not null then perform private.fail('E_SOS_ACTIVE'); end if;
  v_delta := v_now - v_g.paused_at;
  update public.games
     set phase = paused_from,
         phase_started_at = v_now,
         phase_ends_at = v_now + make_interval(secs => paused_remaining_ms / 1000.0),
         next_radar_at = case when radar_remaining_ms is null then null
                              else v_now + make_interval(secs => radar_remaining_ms / 1000.0) end,
         zone_next_at = zone_next_at + v_delta,
         misterx_next_at = misterx_next_at + v_delta,
         running_at = running_at + case when paused_from = 'running' then v_delta else interval '0' end,
         team_state = (select coalesce(jsonb_object_agg(k, case when v ? 'radar_last'
                                 then jsonb_set(v, '{radar_last}', to_jsonb((v ->> 'radar_last')::bigint + private.ms(v_now) - private.ms(v_g.paused_at)))
                                 else v end), '{}'::jsonb)
                         from jsonb_each(team_state) as t(k, v)),
         paused_at = null, paused_from = null, paused_remaining_ms = null, radar_remaining_ms = null
   where id = p_game;
  update public.player_states
     set ghost_until = case when ghost_until > v_g.paused_at then ghost_until + v_delta else ghost_until end,
         jam_until = case when jam_until > v_g.paused_at then jam_until + v_delta else jam_until end,
         decoy_until = case when decoy_until > v_g.paused_at then decoy_until + v_delta else decoy_until end,
         boost_until = case when boost_until > v_g.paused_at then boost_until + v_delta else boost_until end,
         out_of_zone_since = case when out_of_zone_since is not null then out_of_zone_since + v_delta end,
         gps_silent_since = null,
         last_capture_at = last_capture_at + v_delta,
         steps_at = steps_at + v_delta,
         last_seen_at = greatest(last_seen_at, v_now - interval '30 seconds')
   where game_id = p_game;
  update public.ability_usage set used_at = used_at + v_delta, expires_at = expires_at + v_delta where game_id = p_game;
  update public.map_effects set expires_at = expires_at + v_delta where game_id = p_game;
  update public.radar_pulses set expires_at = expires_at + v_delta where game_id = p_game and expires_at > v_g.paused_at;
  perform private.emit(p_game, 'all', 'phase_changed', private.phase_payload(p_game));
  if v_g.mode = 'royale' then perform private.emit(p_game, 'all', 'zone_next', private.zone_payload(p_game)); end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tick : + réduction Royale, révélations Mister X, ouverture de l'extraction,
--        détection du GPS muet
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
  v_stages integer;
  v_pos private.player_positions%rowtype;
  v_mx uuid;
  v_payload jsonb;
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

  -- GPS muet : l'application répond (heartbeat) mais aucune position n'arrive.
  -- Signalé aux joueurs (sécurité), jamais traité comme de la triche.
  for r in
    update public.player_states ps
       set gps_silent_since = v_now
     where ps.game_id = p_game and ps.status = 'active' and ps.connected and ps.gps_silent_since is null
       and coalesce(ps.last_pos_at, v_g.started_at) < v_now - make_interval(secs => (v_g.config ->> 'gps_silent_s')::integer)
     returning ps.user_id, ps.last_pos_at, ps.gps_state, ps.app_state
  loop
    v_payload := jsonb_build_object('u', r.user_id, 'last_pos_at', private.ms(r.last_pos_at), 'gps_state', r.gps_state, 'app_state', r.app_state);
    perform private.emit(p_game, 'all', 'gps_silent', v_payload);
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

    -- Royale : application des réductions échues (et de la suivante annoncée).
    if v_g.mode = 'royale' then
      v_stages := (v_g.config -> 'royale' ->> 'stages')::integer;
      while v_g.zone_next_at is not null and v_now >= v_g.zone_next_at loop
        update public.games
           set zone_current = zone_next, zone_stage = zone_stage + 1,
               zone_next = case when zone_stage + 1 < v_stages then private.royale_zone(p_game, zone_stage + 2, zone_next) end,
               zone_next_at = case when zone_stage + 1 < v_stages then private.royale_time(p_game, zone_stage + 2) end
         where id = p_game
         returning * into v_g;
        perform private.emit(p_game, 'all', 'zone_shrink', private.zone_payload(p_game));
        perform private.recheck_zone(p_game);
      end loop;
    end if;

    -- Hors zone au-delà du délai de grâce : Fugitif éliminé (les Chasseurs hors zone ne peuvent pas capturer).
    for r in
      update public.player_states
         set status = 'captured', captured_at = v_now, captured_by = null
       where game_id = p_game and team = 'fugitive' and status = 'active' and out_of_zone_since is not null
         and out_of_zone_since < v_now - make_interval(secs => (v_g.config ->> 'out_of_zone_grace_s')::integer)
       returning user_id
    loop
      perform private.emit(p_game, 'all', 'capture', jsonb_build_object('f', r.user_id, 'reason', 'out_of_zone'));
    end loop;

    -- Mister X : position exacte révélée aux Chasseurs à intervalle régulier.
    if v_g.mode = 'misterx' and v_g.misterx_next_at is not null and v_now >= v_g.misterx_next_at then
      select user_id into v_mx from public.player_states where game_id = p_game and team = 'fugitive' and status = 'active' limit 1;
      if v_mx is not null then
        v_pos := private.fresh_position(p_game, v_mx, (v_g.config ->> 'stale_after_s')::integer);
        v_payload := case when v_pos.game_id is null
          then jsonb_build_object('u', v_mx, 'lost', true, 'at', private.ms(v_now))
          else jsonb_build_object('u', v_mx, 'lat', round(v_pos.lat::numeric, 5), 'lng', round(v_pos.lng::numeric, 5),
                                  'acc', round(greatest(v_pos.accuracy_m, 5)), 'at', private.ms(v_pos.received_at)) end;
        v_interval := (v_g.config -> 'misterx' ->> 'reveal_interval_s')::integer;
        update public.games set misterx_last = v_payload,
               misterx_next_at = misterx_next_at + make_interval(secs => v_interval *
                 (floor(extract(epoch from (v_now - misterx_next_at)) / v_interval) + 1))
         where id = p_game returning * into v_g;
        perform private.emit(p_game, 'hunter', 'misterx_reveal', v_payload || jsonb_build_object('next_at', private.ms(v_g.misterx_next_at)));
        perform private.emit(p_game, 'p:' || v_mx::text, 'misterx_revealed',
          jsonb_build_object('at', private.ms(v_now), 'lost', v_pos.game_id is null, 'next_at', private.ms(v_g.misterx_next_at)));
      end if;
    end if;

    -- Extraction : ouverture annoncée dans les dernières minutes.
    if not v_g.extraction_opened and (v_g.config -> 'objectives' ->> 'enabled')::boolean
       and (v_g.config -> 'objectives' -> 'extraction' ->> 'set')::boolean
       and v_now >= v_g.phase_ends_at - make_interval(secs => (v_g.config -> 'objectives' ->> 'extraction_open_s')::integer) then
      update public.games set extraction_opened = true where id = p_game;
      perform private.emit(p_game, 'all', 'extraction_open', jsonb_build_object('at', private.ms(v_now)));
    end if;

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
-- Objectifs : balises (une fois chacune) et extraction (Fugitifs)
-- -----------------------------------------------------------------------------
create or replace function private.check_objectives(p_game uuid, p_user uuid, p_lat double precision, p_lng double precision, p_acc double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_g public.games%rowtype;
  v_ps public.player_states%rowtype;
  v_now timestamptz := private.now_();
  o record;
  v_left integer;
begin
  select * into v_g from public.games where id = p_game;
  if v_g.phase <> 'running' or not (v_g.config -> 'objectives' ->> 'enabled')::boolean then return; end if;
  select * into v_ps from public.player_states where game_id = p_game and user_id = p_user;
  if v_ps.team <> 'fugitive' or v_ps.status <> 'active' or v_ps.extracted_at is not null then return; end if;
  if p_acc > (v_g.config ->> 'max_accuracy_m')::double precision then return; end if;

  for o in
    select * from public.game_objectives
     where game_id = p_game and kind = 'beacon' and claimed_by is null
       and private.dist_m(lat, lng, p_lat, p_lng) <= radius_m + least(p_acc, radius_m)
     for update
  loop
    update public.game_objectives set claimed_by = p_user, claimed_at = v_now where game_id = p_game and idx = o.idx;
    update public.player_states set objectives = objectives + 1 where game_id = p_game and user_id = p_user;
    perform private.emit(p_game, 'all', 'objective_claimed', jsonb_build_object('idx', o.idx, 'u', p_user, 'label', o.label));
  end loop;

  if v_g.extraction_opened then
    for o in
      select * from public.game_objectives
       where game_id = p_game and kind = 'extraction' and private.dist_m(lat, lng, p_lat, p_lng) <= radius_m + least(p_acc, radius_m)
    loop
      update public.player_states set extracted_at = v_now where game_id = p_game and user_id = p_user and extracted_at is null;
      perform private.emit(p_game, 'all', 'extracted', jsonb_build_object('u', p_user));
    end loop;
  end if;

  if (v_g.config -> 'objectives' ->> 'win_on_all')::boolean then
    select count(*) into v_left from public.game_objectives where game_id = p_game and kind = 'beacon' and claimed_by is null;
    if v_left = 0 and exists (select 1 from public.game_objectives where game_id = p_game and kind = 'beacon') then
      perform private.finish_game(p_game, 'fugitive', 'objectives');
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Envoi de position : aire de jeu effective, objectifs, Mister X caché,
-- fin du GPS muet.
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
      return jsonb_build_object('accepted', false, 'reason', 'out_of_order', 'server_now', private.ms(v_now));
    end if;
    v_d := private.dist_m(v_prev.lat, v_prev.lng, p_lat, p_lng);
    v_dt := greatest(1, extract(epoch from (v_recorded - v_prev.recorded_at)));
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

  v_out := private.outside_area(v_cfg, v_g.zone_current, p_lat, p_lng, p_accuracy);

  update public.player_states
     set last_pos_at = v_now, accuracy_m = p_accuracy, last_seen_at = v_now, connected = true, gps_silent_since = null,
         distance = distance + case when v_prev.game_id is not null and p_accuracy <= 50 and v_d > p_accuracy / 2 then round(v_d)::integer else 0 end,
         out_of_zone_since = case when v_out then coalesce(out_of_zone_since, v_now) else null end
   where game_id = p_game and user_id = v_ps.user_id;

  if v_ps.gps_silent_since is not null then
    perform private.emit(p_game, 'all', 'gps_ok', jsonb_build_object('u', v_ps.user_id));
  end if;
  if v_out and v_ps.out_of_zone_since is null then
    perform private.emit(p_game, 'all', 'zone_status', jsonb_build_object('u', v_ps.user_id, 'out', true, 'at', private.ms(v_now)));
  elsif not v_out and v_ps.out_of_zone_since is not null then
    perform private.emit(p_game, 'all', 'zone_status', jsonb_build_object('u', v_ps.user_id, 'out', false, 'at', private.ms(v_now)));
  end if;

  -- Coéquipiers : position arrondie à ~10 m (Mister X n'a pas de coéquipier).
  v_ally := private.snap(v_cfg -> 'zone', p_lat, p_lng, 10)
            || jsonb_build_object('u', v_ps.user_id, 'acc', round(greatest(p_accuracy, 10)), 'at', private.ms(v_now));
  perform private.emit(p_game, v_ps.team, 'pos', v_ally);

  -- Adversaires : position approximative (sauf Mister X, révélé seulement à intervalle).
  v_live := v_cfg ->> 'enemy_reveal' = 'live' and not (v_g.mode = 'misterx' and v_ps.team = 'fugitive');
  if v_live and (v_ps.enemy_broadcast_at is null
                 or v_ps.enemy_broadcast_at <= v_now - make_interval(secs => (v_cfg ->> 'enemy_refresh_s')::integer)) then
    perform private.broadcast_enemy(p_game, v_ps.user_id);
  end if;

  perform private.check_objectives(p_game, v_ps.user_id, p_lat, p_lng, p_accuracy);

  perform private.count_usage(1, 0, 0);
  return jsonb_build_object('accepted', true, 'out_of_zone', v_out, 'server_now', private.ms(v_now),
                            'next_in_s', (v_cfg ->> 'position_interval_s')::integer);
end;
$$;

-- Mister X n'est jamais diffusé en continu (ni en « live », ni par impulsions) :
-- seules les révélations périodiques le montrent aux Chasseurs.
create or replace function private.broadcast_enemy(p_game uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team text;
  v_mode text;
  v_payload jsonb;
begin
  select ps.team, g.mode into v_team, v_mode
    from public.player_states ps join public.games g on g.id = ps.game_id
   where ps.game_id = p_game and ps.user_id = p_user;
  if v_mode = 'misterx' and v_team = 'fugitive' then return; end if;
  v_payload := private.enemy_payload(p_game, p_user);
  if v_payload is null then return; end if;
  update public.player_states set enemy_broadcast_at = private.now_(), enemy_view = v_payload
   where game_id = p_game and user_id = p_user;
  perform private.emit(p_game, private.enemy_of(v_team), 'enemy_pos', v_payload);
end;
$$;

-- -----------------------------------------------------------------------------
-- Capture GPS : méthode autorisée, Fugitif extrait protégé
-- -----------------------------------------------------------------------------
create or replace function private.apply_capture(p_game uuid, p_hunter uuid, p_fugitive uuid, p_method text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
  v_now timestamptz := private.now_();
begin
  select mode into v_mode from public.games where id = p_game;
  if v_mode = 'infection' then
    update public.player_states set team = 'hunter', captured_at = v_now, captured_by = p_hunter,
           ghost_until = null, jam_until = null, decoy_until = null, enemy_view = null
     where game_id = p_game and user_id = p_fugitive;
  else
    update public.player_states set status = 'captured', captured_at = v_now, captured_by = p_hunter,
           ghost_until = null, jam_until = null, decoy_until = null
     where game_id = p_game and user_id = p_fugitive;
  end if;
  update public.player_states set captures = captures + 1 where game_id = p_game and user_id = p_hunter;
  perform private.emit(p_game, 'all', 'capture', jsonb_build_object('h', p_hunter, 'f', p_fugitive, 'infected', v_mode = 'infection', 'method', p_method));
  if v_mode = 'infection' then
    perform private.emit(p_game, 'p:' || p_fugitive::text, 'team_changed', jsonb_build_object('team', 'hunter'));
  end if;
end;
$$;

-- Contrôles communs aux deux méthodes de capture (le chasseur appelant).
create or replace function private.capture_preflight(p_game uuid)
returns public.player_states language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := private.now_();
  v_g public.games%rowtype;
  v_ps public.player_states%rowtype;
  v_cd interval;
begin
  select * into v_g from public.games where id = p_game for update;
  select * into v_ps from public.player_states where game_id = p_game and user_id = auth.uid() for update;
  if v_g.phase <> 'running' then perform private.fail('E_CANNOT_CAPTURE_NOW'); end if;
  if v_ps.team <> 'hunter' then perform private.fail('E_WRONG_TEAM'); end if;
  if v_ps.status <> 'active' then perform private.fail('E_NOT_ACTIVE'); end if;
  if v_ps.out_of_zone_since is not null then perform private.fail('E_OUT_OF_ZONE'); end if;
  v_cd := make_interval(secs => (v_g.config ->> 'capture_cooldown_s')::integer);
  if v_ps.last_capture_at is not null and v_ps.last_capture_at + v_cd > v_now then
    perform private.fail('E_COOLDOWN', private.ms(v_ps.last_capture_at + v_cd)::text);
  end if;
  return v_ps;
end;
$$;

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
  v_ps := private.capture_preflight(p_game);
  select * into v_g from public.games where id = p_game;
  v_cfg := v_g.config;
  if v_cfg ->> 'capture_method' = 'qr' then perform private.fail('E_CAPTURE_METHOD', 'qr'); end if;

  v_cd := make_interval(secs => (v_cfg ->> 'capture_cooldown_s')::integer);
  v_me := private.fresh_position(p_game, v_ps.user_id, v_fresh);
  if v_me.game_id is null then perform private.fail('E_POSITION_REQUIRED'); end if;
  if v_me.accuracy_m > (v_cfg ->> 'max_accuracy_m')::real then perform private.fail('E_GPS_IMPRECISE', round(v_me.accuracy_m)::text); end if;

  update public.player_states set last_capture_at = v_now, last_seen_at = v_now, connected = true
   where game_id = p_game and user_id = v_ps.user_id;

  for f in
    select ps.user_id
      from public.player_states ps
      join private.player_positions pp on pp.game_id = ps.game_id and pp.user_id = ps.user_id
     where ps.game_id = p_game and ps.team = 'fugitive' and ps.status = 'active' and ps.extracted_at is null
       and pp.received_at >= v_now - make_interval(secs => v_fresh)
       and pp.accuracy_m <= (v_cfg ->> 'max_accuracy_m')::real
       and private.dist_m(v_me.lat, v_me.lng, pp.lat, pp.lng) <= (v_cfg ->> 'capture_radius_m')::double precision
     for update of ps
  loop
    perform private.apply_capture(p_game, v_ps.user_id, f.user_id, 'gps');
    v_captured := v_captured || f.user_id;
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
-- Capture par QR code (ou code à 6 caractères si la caméra est indisponible)
-- -----------------------------------------------------------------------------
create or replace function private.random_code(p_len integer)
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_out text := '';
  i integer;
begin
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$$;

create or replace function public.get_capture_token(p_game uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ps public.player_states%rowtype := private.require_participant(p_game);
  v_g public.games%rowtype;
  v_now timestamptz := private.now_();
  v_token text;
  v_code text;
  v_exp timestamptz := private.now_() + interval '45 seconds';
begin
  perform private.rate_limit('capture_token', 8, 60000);
  select * into v_g from public.games where id = p_game;
  if v_g.config ->> 'capture_method' = 'gps' then perform private.fail('E_CAPTURE_METHOD', 'gps'); end if;
  if v_g.phase <> 'running' then perform private.fail('E_CANNOT_CAPTURE_NOW'); end if;
  if v_ps.team <> 'fugitive' or v_ps.status <> 'active' then perform private.fail('E_NOT_ACTIVE'); end if;
  delete from private.capture_tokens where game_id = p_game and user_id = v_ps.user_id and used_at is null;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_code := private.random_code(6);
  insert into private.capture_tokens (token_hash, short_code, game_id, user_id, created_at, expires_at)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_code, p_game, v_ps.user_id, v_now, v_exp);
  return jsonb_build_object('qr', 'manhunt:cap:' || p_game::text || ':' || v_token, 'code', v_code, 'expires_at', private.ms(v_exp));
end;
$$;

/**
 * Le Chasseur scanne le QR (ou saisit le code). Le serveur vérifie : jeton
 * valide, non expiré, non utilisé, même partie, Fugitif actif ; si les deux
 * positions sont récentes, une distance plausible (une capture d'écran
 * envoyée de loin est refusée).
 */
create or replace function public.capture_by_token(p_game uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := private.now_();
  v_ps public.player_states%rowtype;
  v_g public.games%rowtype;
  v_t private.capture_tokens%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_token text;
  v_f public.player_states%rowtype;
  v_a private.player_positions%rowtype;
  v_b private.player_positions%rowtype;
  v_limit double precision;
begin
  perform private.require_participant(p_game);
  perform private.rate_limit('capture_code', 5, 10000);
  perform private.tick(p_game);
  v_ps := private.capture_preflight(p_game);
  select * into v_g from public.games where id = p_game;
  if v_g.config ->> 'capture_method' = 'gps' then perform private.fail('E_CAPTURE_METHOD', 'gps'); end if;

  if p_code like 'manhunt:cap:%' then
    if split_part(p_code, ':', 3) <> p_game::text then perform private.fail('E_TOKEN_INVALID', 'other_game'); end if;
    v_token := split_part(p_code, ':', 4);
    select * into v_t from private.capture_tokens
     where token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex') for update;
  else
    select * into v_t from private.capture_tokens
     where game_id = p_game and short_code = v_code and used_at is null and expires_at > v_now
     order by created_at desc limit 1 for update;
  end if;
  if v_t.token_hash is null or v_t.game_id <> p_game then perform private.fail('E_TOKEN_INVALID'); end if;
  if v_t.used_at is not null then perform private.fail('E_TOKEN_USED'); end if;
  if v_t.expires_at <= v_now then perform private.fail('E_TOKEN_EXPIRED'); end if;

  select * into v_f from public.player_states where game_id = p_game and user_id = v_t.user_id for update;
  if v_f.team <> 'fugitive' or v_f.status <> 'active' then perform private.fail('E_TARGET_NOT_ACTIVE'); end if;
  if v_f.extracted_at is not null then perform private.fail('E_TARGET_EXTRACTED'); end if;

  v_a := private.fresh_position(p_game, v_ps.user_id, 30);
  v_b := private.fresh_position(p_game, v_f.user_id, 30);
  if v_a.game_id is not null and v_b.game_id is not null then
    v_limit := greatest(30, (v_g.config ->> 'capture_radius_m')::double precision * 2)
               + least(v_a.accuracy_m, 50) + least(v_b.accuracy_m, 50);
    if private.dist_m(v_a.lat, v_a.lng, v_b.lat, v_b.lng) > v_limit then perform private.fail('E_TOO_FAR'); end if;
  end if;

  update private.capture_tokens set used_at = v_now, used_by = v_ps.user_id where token_hash = v_t.token_hash;
  update public.player_states set last_capture_at = v_now, last_seen_at = v_now, connected = true
   where game_id = p_game and user_id = v_ps.user_id;
  perform private.apply_capture(p_game, v_ps.user_id, v_f.user_id, 'qr');
  perform private.check_victory(p_game);
  perform private.count_usage(1, 0, 0);
  return jsonb_build_object('captured', jsonb_build_array(v_f.user_id), 'server_now', private.ms(v_now));
end;
$$;

-- Événements porteurs de position (retenus 24 h, invisibles des adversaires après la partie).
create or replace function private.is_positional_event(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('pos', 'enemy_pos', 'move', 'reveal', 'radar', 'tracker', 'sonar', 'vis', 'map_effect',
                    'misterx_reveal', 'marker', 'sos');
$$;
