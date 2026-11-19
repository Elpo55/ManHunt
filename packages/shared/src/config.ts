/**
 * Configuration de partie : valeurs par défaut et bornes.
 * MIROIR EXACT de private.normalize_config() (migration 0800) ;
 * tests/db/config-parity.test.ts vérifie la cohérence TS <-> SQL.
 */
import type { AbilityConfig, AbilityKey, ForbiddenZone, GameConfig, GamePlace, GameZone, LatLng } from "./types";

type Bound = { min: number; max: number; step?: number };

export const BOUNDS = {
  duration_s: { min: 300, max: 7200, step: 300 },
  prep_s: { min: 0, max: 900, step: 30 },
  zone_radius_m: { min: 150, max: 3000, step: 50 },
  hunter_ratio: { min: 0.1, max: 0.6, step: 0.05 },
  position_interval_s: { min: 3, max: 30, step: 1 },
  enemy_refresh_s: { min: 5, max: 120, step: 5 },
  approx_m: { min: 10, max: 200, step: 10 },
  stale_after_s: { min: 15, max: 300, step: 5 },
  capture_radius_m: { min: 5, max: 50, step: 1 },
  capture_cooldown_s: { min: 3, max: 120, step: 1 },
  max_accuracy_m: { min: 10, max: 100, step: 5 },
  max_speed_mps: { min: 3, max: 40, step: 1 },
  out_of_zone_grace_s: { min: 15, max: 600, step: 15 },
  disconnect_grace_s: { min: 30, max: 900, step: 30 },
  radar_interval_s: { min: 30, max: 900, step: 15 },
  radar_cooldown_s: { min: 15, max: 900, step: 15 },
  radar_reveal_s: { min: 5, max: 120, step: 5 },
  radar_max_uses: { min: 0, max: 50, step: 1 },
  ability_duration_s: { min: 0, max: 300, step: 5 },
  ability_cooldown_s: { min: 5, max: 900, step: 5 },
  ability_max_uses: { min: 0, max: 20, step: 1 },
  gps_silent_s: { min: 60, max: 600, step: 30 },
  royale_stages: { min: 1, max: 6, step: 1 },
  royale_final_ratio: { min: 0.2, max: 0.8, step: 0.05 },
  royale_warn_s: { min: 30, max: 300, step: 15 },
  misterx_reveal_s: { min: 60, max: 900, step: 30 },
  objective_radius_m: { min: 10, max: 100, step: 5 },
  objective_points: { min: 50, max: 500, step: 25 },
  extraction_open_s: { min: 60, max: 1800, step: 60 },
  extraction_bonus: { min: 0, max: 1000, step: 50 },
  spectator_delay_s: { min: 60, max: 600, step: 30 },
  forbidden_radius_m: { min: 10, max: 1000, step: 10 },
} satisfies Record<string, Bound>;

/** Valeurs par défaut des capacités (= table public.abilities après 0800). */
export const ABILITY_DEFAULTS: Record<AbilityKey, AbilityConfig> = {
  ghost: { enabled: true, duration_s: 30, cooldown_s: 180, max_uses: 2 },
  jammer: { enabled: true, duration_s: 60, cooldown_s: 180, max_uses: 2 },
  decoy: { enabled: true, duration_s: 45, cooldown_s: 180, max_uses: 2 },
  scan: { enabled: true, duration_s: 20, cooldown_s: 90, max_uses: 0 },
  tracker: { enabled: true, duration_s: 0, cooldown_s: 60, max_uses: 3 },
  sonar: { enabled: true, duration_s: 0, cooldown_s: 45, max_uses: 0 },
};

export const DEFAULT_ZONE: GameZone = {
  lat: 48.8556,
  lng: 2.347,
  radius_m: 500,
  label: "Zone non définie",
  set: false,
  shape: "circle",
  polygon: [],
  forbidden: [],
};
const noPlace = (label: string): GamePlace => ({ set: false, lat: 0, lng: 0, label });

export const DEFAULT_CONFIG: GameConfig = {
  mode: "classic",
  duration_s: 1800,
  prep_s: 120,
  zone: DEFAULT_ZONE,
  hunter_ratio: 0.3,
  position_interval_s: 5,
  enemy_reveal: "live",
  enemy_refresh_s: 15,
  approx_m: 30,
  stale_after_s: 45,
  capture_radius_m: 15,
  capture_cooldown_s: 10,
  capture_method: "both",
  max_accuracy_m: 35,
  max_speed_mps: 12,
  out_of_zone_grace_s: 60,
  disconnect_grace_s: 180,
  gps_silent_s: 120,
  radar: {
    enabled: true,
    mode: "auto",
    interval_s: 120,
    precision: "direction",
    teams: "hunter",
    cooldown_s: 120,
    reveal_s: 20,
    max_uses: 0,
  },
  royale: { stages: 3, final_ratio: 0.35, warn_s: 60 },
  misterx: { reveal_interval_s: 180 },
  objectives: {
    enabled: false,
    radius_m: 25,
    points_each: 100,
    win_on_all: false,
    beacons: [],
    extraction: noPlace("Extraction"),
    extraction_open_s: 300,
    extraction_bonus: 300,
  },
  spectators: { enabled: true, delay_s: 180 },
  replay: { enabled: true },
  rendezvous: noPlace("Point de rendez-vous"),
  abilities: ABILITY_DEFAULTS,
};

/** Arrondi « half away from zero » comme PostgreSQL round(numeric). */
function clamp(v: unknown, d: number, b: Bound, decimals = 0): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return d;
  const f = 10 ** decimals;
  const r = (Math.sign(v) * Math.round(Math.abs(v) * f)) / f;
  return Math.min(b.max, Math.max(b.min, r));
}
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
function oneOf<T extends string>(v: unknown, d: T, allowed: readonly T[]): T {
  return allowed.includes(v as T) ? (v as T) : d;
}
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// Même nettoyage que le serveur : < > " et caractères de contrôle, espaces de bord.
function cleanLabel(v: unknown, max: number, fallback: string): string {
  const raw = typeof v === "string" ? v : "";
  const label = raw.replace(/[<>"\u0000-\u001f\u007f]/g, "").replace(/^ +| +$/g, "").slice(0, max);
  return label || fallback;
}
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
const LAT = { min: -85, max: 85 };
const LNG = { min: -180, max: 180 };

/** Liste de points {lat, lng} (6 décimales) ; éléments invalides ignorés. */
export function normalizePoints(p: unknown, max: number): LatLng[] {
  if (!Array.isArray(p)) return [];
  const out: LatLng[] = [];
  for (const e of p) {
    if (out.length >= max) break;
    const o = obj(e);
    if (!isObj(e) || !isNum(o.lat) || !isNum(o.lng)) continue;
    out.push({ lat: clamp(o.lat, 0, LAT, 6), lng: clamp(o.lng, 0, LNG, 6) });
  }
  return out;
}

function normalizeForbidden(p: unknown): ForbiddenZone[] {
  if (!Array.isArray(p)) return [];
  const out: ForbiddenZone[] = [];
  for (const e of p) {
    if (out.length >= 10) break;
    if (!isObj(e)) continue;
    const o = obj(e);
    if (o.kind === "polygon") {
      const points = normalizePoints(o.points, 20);
      if (points.length < 3) continue;
      out.push({ kind: "polygon", points, label: cleanLabel(o.label, 40, "Zone interdite") });
    } else {
      if (!isNum(o.lat) || !isNum(o.lng)) continue;
      out.push({
        kind: "circle",
        lat: clamp(o.lat, 0, LAT, 6),
        lng: clamp(o.lng, 0, LNG, 6),
        radius_m: clamp(o.radius_m, 50, BOUNDS.forbidden_radius_m),
        label: cleanLabel(o.label, 40, "Zone interdite"),
      });
    }
  }
  return out;
}

export function normalizePlace(p: unknown, fallback: string): GamePlace {
  const o = obj(p);
  return {
    set: bool(o.set, false) && isNum(o.lat) && isNum(o.lng),
    lat: clamp(o.lat, 0, LAT, 6),
    lng: clamp(o.lng, 0, LNG, 6),
    label: cleanLabel(o.label, 40, fallback),
  };
}

export function normalizeZone(z: unknown): GameZone {
  const o = obj(z);
  const poly = normalizePoints(o.polygon, 20);
  const isPoly = o.shape === "polygon" && poly.length >= 3;
  return {
    lat: clamp(o.lat, DEFAULT_ZONE.lat, LAT, 6),
    lng: clamp(o.lng, DEFAULT_ZONE.lng, LNG, 6),
    radius_m: clamp(o.radius_m, DEFAULT_ZONE.radius_m, BOUNDS.zone_radius_m),
    label: cleanLabel(o.label, 80, DEFAULT_ZONE.label),
    set: bool(o.set, false),
    shape: isPoly ? "polygon" : "circle",
    polygon: isPoly ? poly : [],
    forbidden: normalizeForbidden(o.forbidden),
  };
}

export function normalizeConfig(input: unknown): GameConfig {
  const c = obj(input);
  const r = obj(c.radar);
  const ab = obj(c.abilities);
  const ro = obj(c.royale);
  const mx = obj(c.misterx);
  const ob = obj(c.objectives);
  const sp = obj(c.spectators);
  const rp = obj(c.replay);
  const D = DEFAULT_CONFIG;
  const beacons: GameConfig["objectives"]["beacons"] = [];
  if (Array.isArray(ob.beacons)) {
    for (const e of ob.beacons) {
      if (beacons.length >= 10) break;
      const o = obj(e);
      if (!isObj(e) || !isNum(o.lat) || !isNum(o.lng)) continue;
      beacons.push({ lat: clamp(o.lat, 0, LAT, 6), lng: clamp(o.lng, 0, LNG, 6), label: cleanLabel(o.label, 40, `Balise ${beacons.length + 1}`) });
    }
  }
  const abilities = {} as Record<AbilityKey, AbilityConfig>;
  for (const key of Object.keys(ABILITY_DEFAULTS) as AbilityKey[]) {
    const a = obj(ab[key]);
    const d = ABILITY_DEFAULTS[key];
    abilities[key] = {
      enabled: bool(a.enabled, true),
      duration_s: clamp(a.duration_s, d.duration_s, BOUNDS.ability_duration_s),
      cooldown_s: clamp(a.cooldown_s, d.cooldown_s, BOUNDS.ability_cooldown_s),
      max_uses: clamp(a.max_uses, d.max_uses, BOUNDS.ability_max_uses),
    };
  }
  return {
    mode: oneOf(c.mode, D.mode, ["classic", "infection", "royale", "misterx"] as const),
    duration_s: clamp(c.duration_s, D.duration_s, BOUNDS.duration_s),
    prep_s: clamp(c.prep_s, D.prep_s, BOUNDS.prep_s),
    zone: normalizeZone(c.zone),
    hunter_ratio: clamp(c.hunter_ratio, D.hunter_ratio, BOUNDS.hunter_ratio, 2),
    position_interval_s: clamp(c.position_interval_s, D.position_interval_s, BOUNDS.position_interval_s),
    enemy_reveal: oneOf(c.enemy_reveal, D.enemy_reveal, ["live", "pulse"] as const),
    enemy_refresh_s: clamp(c.enemy_refresh_s, D.enemy_refresh_s, BOUNDS.enemy_refresh_s),
    approx_m: clamp(c.approx_m, D.approx_m, BOUNDS.approx_m),
    stale_after_s: clamp(c.stale_after_s, D.stale_after_s, BOUNDS.stale_after_s),
    capture_radius_m: clamp(c.capture_radius_m, D.capture_radius_m, BOUNDS.capture_radius_m),
    capture_cooldown_s: clamp(c.capture_cooldown_s, D.capture_cooldown_s, BOUNDS.capture_cooldown_s),
    capture_method: oneOf(c.capture_method, D.capture_method, ["gps", "qr", "both"] as const),
    max_accuracy_m: clamp(c.max_accuracy_m, D.max_accuracy_m, BOUNDS.max_accuracy_m),
    max_speed_mps: clamp(c.max_speed_mps, D.max_speed_mps, BOUNDS.max_speed_mps),
    out_of_zone_grace_s: clamp(c.out_of_zone_grace_s, D.out_of_zone_grace_s, BOUNDS.out_of_zone_grace_s),
    disconnect_grace_s: clamp(c.disconnect_grace_s, D.disconnect_grace_s, BOUNDS.disconnect_grace_s),
    gps_silent_s: clamp(c.gps_silent_s, D.gps_silent_s, BOUNDS.gps_silent_s),
    radar: {
      enabled: bool(r.enabled, D.radar.enabled),
      mode: oneOf(r.mode, D.radar.mode, ["auto", "manual"] as const),
      interval_s: clamp(r.interval_s, D.radar.interval_s, BOUNDS.radar_interval_s),
      precision: oneOf(r.precision, D.radar.precision, ["direction", "sector", "zone"] as const),
      teams: oneOf(r.teams, D.radar.teams, ["hunter", "fugitive", "both"] as const),
      cooldown_s: clamp(r.cooldown_s, D.radar.cooldown_s, BOUNDS.radar_cooldown_s),
      reveal_s: clamp(r.reveal_s, D.radar.reveal_s, BOUNDS.radar_reveal_s),
      max_uses: clamp(r.max_uses, D.radar.max_uses, BOUNDS.radar_max_uses),
    },
    royale: {
      stages: clamp(ro.stages, D.royale.stages, BOUNDS.royale_stages),
      final_ratio: clamp(ro.final_ratio, D.royale.final_ratio, BOUNDS.royale_final_ratio, 2),
      warn_s: clamp(ro.warn_s, D.royale.warn_s, BOUNDS.royale_warn_s),
    },
    misterx: { reveal_interval_s: clamp(mx.reveal_interval_s, D.misterx.reveal_interval_s, BOUNDS.misterx_reveal_s) },
    objectives: {
      enabled: bool(ob.enabled, false),
      radius_m: clamp(ob.radius_m, D.objectives.radius_m, BOUNDS.objective_radius_m),
      points_each: clamp(ob.points_each, D.objectives.points_each, BOUNDS.objective_points),
      win_on_all: bool(ob.win_on_all, false),
      beacons,
      extraction: normalizePlace(ob.extraction, "Extraction"),
      extraction_open_s: clamp(ob.extraction_open_s, D.objectives.extraction_open_s, BOUNDS.extraction_open_s),
      extraction_bonus: clamp(ob.extraction_bonus, D.objectives.extraction_bonus, BOUNDS.extraction_bonus),
    },
    spectators: {
      enabled: bool(sp.enabled, true),
      delay_s: clamp(sp.delay_s, D.spectators.delay_s, BOUNDS.spectator_delay_s),
    },
    replay: { enabled: bool(rp.enabled, true) },
    rendezvous: normalizePlace(c.rendezvous, "Point de rendez-vous"),
    abilities,
  };
}

/** Préréglages : ne changent ni le lieu ni le mode, seulement le rythme. */
export const PRESETS: { id: string; label: string; description: string; zoneRadius: number; config: Partial<GameConfig> }[] = [
  {
    id: "quartier",
    label: "Quartier",
    description: "20 min sur 300 m de rayon, radar toutes les 90 s.",
    zoneRadius: 300,
    config: { duration_s: 1200, prep_s: 90, radar: { ...DEFAULT_CONFIG.radar, interval_s: 90 } },
  },
  {
    id: "parc",
    label: "Parc",
    description: "30 min sur 500 m, réglages équilibrés.",
    zoneRadius: 500,
    config: {},
  },
  {
    id: "ville",
    label: "Grande traque",
    description: "60 min sur 1,2 km, positions révélées par impulsions.",
    zoneRadius: 1200,
    config: { duration_s: 3600, prep_s: 300, enemy_reveal: "pulse", radar: { ...DEFAULT_CONFIG.radar, interval_s: 180 } },
  },
];

export function applyPreset(current: GameConfig, presetId: string): GameConfig {
  const p = PRESETS.find((x) => x.id === presetId);
  if (!p) return current;
  return normalizeConfig({
    ...p.config,
    mode: current.mode,
    abilities: current.abilities,
    zone: { ...current.zone, radius_m: p.zoneRadius },
  });
}
