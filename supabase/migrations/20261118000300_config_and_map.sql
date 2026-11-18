-- =============================================================================
-- 0300 — Catalogue des capacités, normalisation de configuration, carte.
-- Les bornes ci-dessous DOIVENT rester identiques à src/lib/engine/config.ts
-- (un test d'intégration vérifie la cohérence TS <-> SQL).
-- =============================================================================

insert into public.abilities (key, team, name, description, targeting, duration_s, cooldown_s, max_uses, params, notify, sort_order) values
  ('ghost',   'fugitive', 'Fantôme',      'Vous disparaissez de la vue des Chasseurs pendant quelques secondes. Le radar et le Scan peuvent toujours vous repérer.', 'none', 12, 75, 2, '{}'::jsonb, 'team', 10),
  ('jammer',  'fugitive', 'Brouilleur',   'Vos signaux deviennent illisibles pour le radar et le Traqueur adverses.', 'none', 45, 120, 2, '{}'::jsonb, 'team', 20),
  ('sprint',  'fugitive', 'Accélération', 'Gagnez 2 pas immédiatement et régénérez vos pas deux fois plus vite.', 'none', 15, 60, 0, '{"bonus_steps":2}'::jsonb, 'team', 30),
  ('scan',    'hunter',   'Scan',         'Révèle la position exacte des Fugitifs autour d''une case ciblée à portée.', 'cell', 8, 45, 0, '{"range":7,"radius":2}'::jsonb, 'team', 10),
  ('tracker', 'hunter',   'Traqueur',     'Indique la direction et la distance approximative du Fugitif le plus proche.', 'none', 0, 60, 3, '{}'::jsonb, 'team', 20),
  ('barrier', 'hunter',   'Blocage',      'Ferme temporairement une case à portée pour tous les joueurs.', 'cell', 40, 50, 0, '{"range":4}'::jsonb, 'all', 30)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Lecture bornée de valeurs de configuration
-- -----------------------------------------------------------------------------
create or replace function private.cfg_int(c jsonb, k text, d integer, lo integer, hi integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(lo, least(hi, coalesce(
    case when jsonb_typeof(c -> k) = 'number' then round((c ->> k)::numeric)::integer end, d)))
$$;

create or replace function private.cfg_num(c jsonb, k text, d numeric, lo numeric, hi numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(lo, least(hi, coalesce(
    case when jsonb_typeof(c -> k) = 'number' then round((c ->> k)::numeric, 2) end, d)))
$$;

create or replace function private.cfg_bool(c jsonb, k text, d boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case when jsonb_typeof(c -> k) = 'boolean' then (c ->> k)::boolean end, d)
$$;

create or replace function private.cfg_enum(c jsonb, k text, d text, allowed text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case when (c ->> k) = any (allowed) then c ->> k else d end
$$;

-- -----------------------------------------------------------------------------
-- normalize_config : fusionne la configuration fournie avec les valeurs par
-- défaut et borne chaque paramètre. Toute config utilisée en jeu passe ici.
-- -----------------------------------------------------------------------------
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
    'map_size',           private.cfg_enum(c, 'map_size', 'm', array['s', 'm', 'l']),
    'obstacle_density',   private.cfg_num(c, 'obstacle_density', 0.16, 0, 0.3),
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

-- -----------------------------------------------------------------------------
-- Carte : grille de caractères.
--   '.' case libre   '#' bâtiment (bloquant)   '~' zone interdite (bloquante)
-- Représentation : {"w":22,"h":22,"rows":["....#..", ...]}
-- -----------------------------------------------------------------------------
create or replace function private.map_dims(p_size text)
returns integer
language sql
immutable
set search_path = ''
as $$ select case p_size when 's' then 16 when 'l' then 30 else 22 end $$;

create or replace function private.cell(p_map jsonb, p_x integer, p_y integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_x < 0 or p_y < 0 or p_x >= (p_map ->> 'w')::integer or p_y >= (p_map ->> 'h')::integer then '#'
    else substr(p_map -> 'rows' ->> p_y, p_x + 1, 1)
  end
$$;

create or replace function private.open_cells(p_map jsonb)
returns table (x integer, y integer)
language sql
immutable
set search_path = ''
as $$
  select gx, gy
  from generate_series(0, (p_map ->> 'w')::integer - 1) gx
  cross join generate_series(0, (p_map ->> 'h')::integer - 1) gy
  where substr(p_map -> 'rows' ->> gy, gx + 1, 1) = '.'
$$;

create or replace function private.generate_map(p_size text, p_density numeric, p_forbidden boolean, p_seed bigint)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  w integer := private.map_dims(p_size);
  h integer := w;
  g text[] := array_fill('.'::text, array[w * h]);
  n_buildings integer := round(w * h * p_density / 4.0);
  n_zones integer := case when p_forbidden then 1 + (w >= 22)::integer + (w >= 30)::integer else 0 end;
  i integer; b_x integer; b_y integer; bw integer; bh integer; xx integer; yy integer;
  visited boolean[] := array_fill(false, array[w * h]);
  queue integer[] := '{}';
  head integer := 1;
  cur integer; cx integer; cy integer; nidx integer;
  start integer := null;
  best numeric := 1e9; d numeric;
  rows_out jsonb := '[]'::jsonb;
  line text;
begin
  -- Bâtiments (rectangles 1..3 x 1..3)
  for i in 0 .. n_buildings - 1 loop
    bw := 1 + floor(private.hash01(p_seed, 'bw' || i) * 3)::integer;
    bh := 1 + floor(private.hash01(p_seed, 'bh' || i) * 3)::integer;
    b_x := floor(private.hash01(p_seed, 'b_x' || i) * (w - bw + 1))::integer;
    b_y := floor(private.hash01(p_seed, 'b_y' || i) * (h - bh + 1))::integer;
    for yy in b_y .. b_y + bh - 1 loop
      for xx in b_x .. b_x + bw - 1 loop
        g[yy * w + xx + 1] := '#';
      end loop;
    end loop;
  end loop;

  -- Zones interdites virtuelles (rectangles 2..4)
  for i in 0 .. n_zones - 1 loop
    bw := 2 + floor(private.hash01(p_seed, 'zw' || i) * 3)::integer;
    bh := 2 + floor(private.hash01(p_seed, 'zh' || i) * 3)::integer;
    b_x := floor(private.hash01(p_seed, 'zx' || i) * (w - bw + 1))::integer;
    b_y := floor(private.hash01(p_seed, 'zy' || i) * (h - bh + 1))::integer;
    for yy in b_y .. b_y + bh - 1 loop
      for xx in b_x .. b_x + bw - 1 loop
        if g[yy * w + xx + 1] = '.' then
          g[yy * w + xx + 1] := '~';
        end if;
      end loop;
    end loop;
  end loop;

  -- Point de départ du remplissage : case libre la plus proche du centre
  for i in 0 .. w * h - 1 loop
    if g[i + 1] = '.' then
      d := power((i % w) - (w - 1) / 2.0, 2) + power((i / w) - (h - 1) / 2.0, 2);
      if d < best then best := d; start := i; end if;
    end if;
  end loop;
  if start is null then
    -- Densité absurde : on repart d'une carte vide.
    g := array_fill('.'::text, array[w * h]);
    start := (h / 2) * w + w / 2;
  end if;

  -- Connexité : toute case libre non atteignable devient un bâtiment
  queue := array[start];
  visited[start + 1] := true;
  while head <= coalesce(array_length(queue, 1), 0) loop
    cur := queue[head];
    head := head + 1;
    cx := cur % w;
    cy := cur / w;
    foreach nidx in array array[
      case when cx > 0 then cur - 1 else -1 end,
      case when cx < w - 1 then cur + 1 else -1 end,
      case when cy > 0 then cur - w else -1 end,
      case when cy < h - 1 then cur + w else -1 end
    ] loop
      if nidx >= 0 and not visited[nidx + 1] and g[nidx + 1] = '.' then
        visited[nidx + 1] := true;
        queue := queue || nidx;
      end if;
    end loop;
  end loop;

  for i in 0 .. w * h - 1 loop
    if g[i + 1] = '.' and not visited[i + 1] then
      g[i + 1] := '#';
    end if;
  end loop;

  for yy in 0 .. h - 1 loop
    line := array_to_string(g[yy * w + 1 : yy * w + w], '');
    rows_out := rows_out || to_jsonb(line);
  end loop;

  return jsonb_build_object('w', w, 'h', h, 'rows', rows_out);
end;
$$;

-- -----------------------------------------------------------------------------
-- Géométrie
-- -----------------------------------------------------------------------------
-- Disque « roguelike » : dx² + dy² <= r² + r (identique à src/lib/engine/grid.ts)
create or replace function private.in_radius(dx integer, dy integer, r integer)
returns boolean
language sql
immutable
set search_path = ''
as $$ select dx * dx + dy * dy <= r * r + r $$;

create or replace function private.cheb(ax integer, ay integer, b_x integer, b_y integer)
returns integer
language sql
immutable
set search_path = ''
as $$ select greatest(abs(ax - b_x), abs(ay - b_y)) $$;

-- Direction cardinale (8 secteurs) de A vers B. Axe y vers le bas (Sud).
create or replace function private.direction8(ax integer, ay integer, b_x integer, b_y integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when ax = b_x and ay = b_y then 'here'
    else (array['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'])[
      (((round(degrees(atan2((b_y - ay)::double precision, (b_x - ax)::double precision)) / 45.0)::integer) % 8 + 8) % 8) + 1
    ]
  end
$$;

create or replace function private.distance_band(d double precision)
returns text
language sql
immutable
set search_path = ''
as $$ select case when d <= 5 then 'near' when d <= 11 then 'mid' else 'far' end $$;
