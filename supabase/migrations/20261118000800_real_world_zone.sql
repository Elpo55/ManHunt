-- =============================================================================
-- 0800 — Carte du monde réel.
--
-- La carte fictive (bâtiments générés) est remplacée par une ZONE DE JEU
-- RÉELLE : un cercle (centre latitude/longitude + rayon en mètres) choisi par
-- l'hôte sur une carte OpenStreetMap.
--
-- Le serveur découpe cette zone en un maillage invisible de cases carrées
-- (25 m pour une petite zone, 40 x 40 cases maximum). Les positions des joueurs restent des
-- coordonnées VIRTUELLES (indices de case) validées par le serveur ; le
-- client les convertit en coordonnées géographiques pour l'affichage.
-- Aucune position GPS réelle n'est jamais lue ni stockée.
--
-- Caractères de la grille :
--   '.' case jouable   '#' hors de la zone   '~' zone interdite virtuelle
-- La logique de jeu existante (chemins, vision, captures, radar, capacités)
-- est inchangée : elle opère sur les cases.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuration : `zone` remplace `map_size` et `obstacle_density`.
-- -----------------------------------------------------------------------------
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
  v_label := left(btrim(regexp_replace(coalesce(case when jsonb_typeof(z -> 'label') = 'string' then z ->> 'label' end, ''),
                                       '[<>"[:cntrl:]]', '', 'g')), 80);
  return jsonb_build_object(
    -- Défaut : Paris, Île de la Cité (la zone est modifiable par l'hôte).
    'lat',      private.cfg_num6(z, 'lat', 48.8556, -85, 85),
    'lng',      private.cfg_num6(z, 'lng', 2.3470, -180, 180),
    'radius_m', private.cfg_int(z, 'radius_m', 600, 200, 3000),
    'label',    case when v_label = '' then 'Paris — Île de la Cité' else v_label end
  );
end;
$$;

-- Nombre borné à 6 décimales (~0,1 m), pour les coordonnées.
create or replace function private.cfg_num6(c jsonb, k text, d numeric, lo numeric, hi numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(lo, least(hi, coalesce(
    case when jsonb_typeof(c -> k) = 'number' then round((c ->> k)::numeric, 6) end, d)))
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
  if c is null or jsonb_typeof(c) <> 'object' then
    c := '{}'::jsonb;
  end if;
  if jsonb_typeof(r) <> 'object' then r := '{}'::jsonb; end if;
  if jsonb_typeof(ab) <> 'object' then ab := '{}'::jsonb; end if;

  for a in select * from public.abilities where enabled order by team, sort_order loop
    ac := coalesce(ab -> a.key, '{}'::jsonb);
    if jsonb_typeof(ac) <> 'object' then ac := '{}'::jsonb; end if;
    out_abilities := out_abilities || jsonb_build_object(a.key, jsonb_build_object(
      'enabled',    private.cfg_bool(ac, 'enabled', true),
      'duration_s', private.cfg_int(ac, 'duration_s', a.duration_s, 0, 120),
      'cooldown_s', private.cfg_int(ac, 'cooldown_s', a.cooldown_s, 5, 600),
      'max_uses',   private.cfg_int(ac, 'max_uses', a.max_uses, 0, 20)
    ));
  end loop;

  return jsonb_build_object(
    'mode',               private.cfg_enum(c, 'mode', 'classic', array['classic', 'infection']),
    'duration_s',         private.cfg_int(c, 'duration_s', 900, 120, 3600),
    'prep_s',             private.cfg_int(c, 'prep_s', 60, 0, 600),
    'zone',               private.normalize_zone(c -> 'zone'),
    'forbidden_zones',    private.cfg_bool(c, 'forbidden_zones', true),
    'hunter_ratio',       private.cfg_num(c, 'hunter_ratio', 0.3, 0.1, 0.6),
    'step_regen_ms',      private.cfg_int(c, 'step_regen_ms', 2000, 500, 10000),
    'max_steps',          private.cfg_int(c, 'max_steps', 4, 1, 10),
    'vision_hunter',      private.cfg_int(c, 'vision_hunter', 2, 1, 6),
    'vision_fugitive',    private.cfg_int(c, 'vision_fugitive', 3, 1, 6),
    'capture_range',      private.cfg_int(c, 'capture_range', 1, 0, 2),
    'capture_cooldown_s', private.cfg_int(c, 'capture_cooldown_s', 5, 1, 60),
    'disconnect_grace_s', private.cfg_int(c, 'disconnect_grace_s', 120, 30, 900),
    'radar', jsonb_build_object(
      'enabled',    private.cfg_bool(r, 'enabled', true),
      'mode',       private.cfg_enum(r, 'mode', 'auto', array['auto', 'manual']),
      'interval_s', private.cfg_int(r, 'interval_s', 60, 15, 600),
      'precision',  private.cfg_enum(r, 'precision', 'sector', array['direction', 'sector', 'zone']),
      'teams',      private.cfg_enum(r, 'teams', 'hunter', array['hunter', 'fugitive', 'both']),
      'cooldown_s', private.cfg_int(r, 'cooldown_s', 60, 10, 600),
      'reveal_s',   private.cfg_int(r, 'reveal_s', 12, 3, 60),
      'max_uses',   private.cfg_int(r, 'max_uses', 0, 0, 50)
    ),
    'abilities', out_abilities
  );
end;
$$;

-- Les salons existants passent au nouveau format.
update public.rooms set config = private.normalize_config(config);

-- -----------------------------------------------------------------------------
-- Maillage de la zone réelle
--   n = nombre de cases sur le diamètre : round(2r / 25 m), borné 16..40
--   cell_m = 2r / n  (25 m pour r <= 500 m, 37,5 m pour 750 m, 150 m pour 3 km)
-- Centre de la case (x, y) en mètres depuis le centre de la zone :
--   dx = (x + 0.5 - n/2) * cell_m   (Est positif)
--   dy = (y + 0.5 - n/2) * cell_m   (Sud positif)
-- Formules identiques à src/lib/map/geo.ts.
-- -----------------------------------------------------------------------------
create or replace function private.zone_cells(p_radius integer)
returns integer
language sql
immutable
set search_path = ''
as $$ select greatest(16, least(40, round(2.0 * p_radius / 25.0)::integer)) $$;

create or replace function private.generate_zone_map(p_zone jsonb, p_forbidden boolean, p_seed bigint)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_r integer := (p_zone ->> 'radius_m')::integer;
  n integer := private.zone_cells(v_r);
  v_cell numeric := round(2.0 * v_r / n, 3);
  g text[] := array_fill('#'::text, array[n * n]);
  i integer; xx integer; yy integer;
  dx numeric; dy numeric;
  n_zones integer := case when p_forbidden then 1 + (n >= 28)::integer + (n >= 36)::integer else 0 end;
  zx integer; zy integer; zr integer;
  visited boolean[] := array_fill(false, array[n * n]);
  queue integer[];
  head integer := 1;
  cur integer; cx integer; cy integer; nidx integer;
  start integer;
  rows_out jsonb := '[]'::jsonb;
begin
  -- Cases dont le centre est dans le cercle : jouables.
  for yy in 0 .. n - 1 loop
    for xx in 0 .. n - 1 loop
      dx := (xx + 0.5 - n / 2.0) * v_cell;
      dy := (yy + 0.5 - n / 2.0) * v_cell;
      if dx * dx + dy * dy <= v_r::numeric * v_r then
        g[yy * n + xx + 1] := '.';
      end if;
    end loop;
  end loop;

  -- Zones interdites virtuelles : petits disques hors du centre.
  for i in 0 .. n_zones - 1 loop
    zr := 1 + floor(private.hash01(p_seed, 'zr' || i) * 2)::integer;
    zx := floor(n * (0.2 + 0.6 * private.hash01(p_seed, 'zx' || i)))::integer;
    zy := floor(n * (0.2 + 0.6 * private.hash01(p_seed, 'zy' || i)))::integer;
    if abs(zx - n / 2) + abs(zy - n / 2) < 4 then
      zx := least(n - 2, zx + 5);
    end if;
    for yy in greatest(0, zy - zr) .. least(n - 1, zy + zr) loop
      for xx in greatest(0, zx - zr) .. least(n - 1, zx + zr) loop
        if private.in_radius(xx - zx, yy - zy, zr) and g[yy * n + xx + 1] = '.' then
          g[yy * n + xx + 1] := '~';
        end if;
      end loop;
    end loop;
  end loop;

  -- Connexité depuis le centre (une case jouable isolée devient interdite).
  start := (n / 2) * n + n / 2;
  if g[start + 1] <> '.' then
    select k into start from generate_series(0, n * n - 1) k where g[k + 1] = '.' limit 1;
  end if;
  queue := array[start];
  visited[start + 1] := true;
  while head <= coalesce(array_length(queue, 1), 0) loop
    cur := queue[head];
    head := head + 1;
    cx := cur % n;
    cy := cur / n;
    foreach nidx in array array[
      case when cx > 0 then cur - 1 else -1 end,
      case when cx < n - 1 then cur + 1 else -1 end,
      case when cy > 0 then cur - n else -1 end,
      case when cy < n - 1 then cur + n else -1 end
    ] loop
      if nidx >= 0 and not visited[nidx + 1] and g[nidx + 1] = '.' then
        visited[nidx + 1] := true;
        queue := queue || nidx;
      end if;
    end loop;
  end loop;
  for i in 0 .. n * n - 1 loop
    if g[i + 1] = '.' and not visited[i + 1] then
      g[i + 1] := '~';
    end if;
  end loop;

  for yy in 0 .. n - 1 loop
    rows_out := rows_out || to_jsonb(array_to_string(g[yy * n + 1 : yy * n + n], ''));
  end loop;

  return jsonb_build_object(
    'w', n, 'h', n, 'rows', rows_out,
    'geo', jsonb_build_object(
      'lat', (p_zone ->> 'lat')::numeric,
      'lng', (p_zone ->> 'lng')::numeric,
      'radius_m', v_r,
      'cell_m', v_cell,
      'label', p_zone ->> 'label'));
end;
$$;

-- -----------------------------------------------------------------------------
-- start_game : identique à 0500, carte générée depuis la zone réelle.
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
  v_map := private.generate_zone_map(v_cfg -> 'zone', (v_cfg ->> 'forbidden_zones')::boolean, v_seed);
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

  -- Base des Chasseurs : bord de la zone, direction tirée au sort.
  v_corner := floor(random() * 4)::integer;
  v_cx := case when v_corner in (0, 3) then 1 else v_w - 2 end;
  v_cy := case when v_corner in (0, 1) then 1 else v_h - 2 end;
  select oc.x, oc.y into v_bx, v_by
    from private.open_cells(v_map) oc
   order by power(oc.x - v_cx, 2) + power(oc.y - v_cy, 2), oc.x, oc.y
   limit 1;

  insert into public.player_states (game_id, user_id, team, initial_team, x, y, steps, steps_at, last_seen_at, joined_at)
  select v_game_id, h.user_id, 'hunter', 'hunter', c.x, c.y, (v_cfg ->> 'max_steps')::integer, v_now, v_now, v_now
    from (select user_id, row_number() over (order by random()) rn
            from public.room_members where room_id = p_room and team = 'hunter') h
    join (select oc.x, oc.y, row_number() over (order by power(oc.x - v_bx, 2) + power(oc.y - v_by, 2), random()) rn
            from private.open_cells(v_map) oc) c
      on c.rn = h.rn;

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

-- La carte fictive n'est plus utilisée.
drop function if exists private.generate_map(text, numeric, boolean, bigint);
drop function if exists private.map_dims(text);

revoke execute on function private.normalize_zone(jsonb), private.cfg_num6(jsonb, text, numeric, numeric, numeric),
  private.zone_cells(integer), private.generate_zone_map(jsonb, boolean, bigint) from public, anon;
revoke execute on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;
