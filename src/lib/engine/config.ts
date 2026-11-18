/**
 * Configuration de partie : valeurs par défaut et bornes.
 * MIROIR EXACT de private.normalize_config() (migration 0300).
 * Le test tests/db/config-parity.test.ts garantit la cohérence TS <-> SQL.
 */
import type { AbilityConfig, AbilityKey, GameConfig, GameZone } from "./types";

type Bound = { min: number; max: number; step?: number };

export const BOUNDS = {
  duration_s: { min: 120, max: 3600, step: 60 },
  prep_s: { min: 0, max: 600, step: 15 },
  zone_radius_m: { min: 200, max: 3000, step: 50 },
  hunter_ratio: { min: 0.1, max: 0.6, step: 0.05 },
  step_regen_ms: { min: 500, max: 10000, step: 250 },
  max_steps: { min: 1, max: 10, step: 1 },
  vision_hunter: { min: 1, max: 6, step: 1 },
  vision_fugitive: { min: 1, max: 6, step: 1 },
  capture_range: { min: 0, max: 2, step: 1 },
  capture_cooldown_s: { min: 1, max: 60, step: 1 },
  disconnect_grace_s: { min: 30, max: 900, step: 30 },
  radar_interval_s: { min: 15, max: 600, step: 15 },
  radar_cooldown_s: { min: 10, max: 600, step: 5 },
  radar_reveal_s: { min: 3, max: 60, step: 1 },
  radar_max_uses: { min: 0, max: 50, step: 1 },
  ability_duration_s: { min: 0, max: 120, step: 1 },
  ability_cooldown_s: { min: 5, max: 600, step: 5 },
  ability_max_uses: { min: 0, max: 20, step: 1 },
} satisfies Record<string, Bound>;

/** Valeurs par défaut des capacités (= table public.abilities). */
export const ABILITY_DEFAULTS: Record<AbilityKey, AbilityConfig> = {
  ghost: { enabled: true, duration_s: 12, cooldown_s: 75, max_uses: 2 },
  jammer: { enabled: true, duration_s: 45, cooldown_s: 120, max_uses: 2 },
  sprint: { enabled: true, duration_s: 15, cooldown_s: 60, max_uses: 0 },
  scan: { enabled: true, duration_s: 8, cooldown_s: 45, max_uses: 0 },
  tracker: { enabled: true, duration_s: 0, cooldown_s: 60, max_uses: 3 },
  barrier: { enabled: true, duration_s: 40, cooldown_s: 50, max_uses: 0 },
};

export const DEFAULT_CONFIG: GameConfig = {
  mode: "classic",
  duration_s: 900,
  prep_s: 60,
  zone: { lat: 48.8556, lng: 2.347, radius_m: 600, label: "Paris — Île de la Cité" },
  forbidden_zones: true,
  hunter_ratio: 0.3,
  step_regen_ms: 2000,
  max_steps: 4,
  vision_hunter: 2,
  vision_fugitive: 3,
  capture_range: 1,
  capture_cooldown_s: 5,
  disconnect_grace_s: 120,
  radar: {
    enabled: true,
    mode: "auto",
    interval_s: 60,
    precision: "sector",
    teams: "hunter",
    cooldown_s: 60,
    reveal_s: 12,
    max_uses: 0,
  },
  abilities: ABILITY_DEFAULTS,
};

/** Nombre de cases sur le diamètre de la zone (identique à private.zone_cells). */
export function zoneCells(radiusM: number): number {
  return Math.max(16, Math.min(40, Math.round((2 * radiusM) / 25)));
}

function normalizeZone(z: unknown): GameZone {
  const o = (z && typeof z === "object" ? z : {}) as Record<string, unknown>;
  const D = DEFAULT_CONFIG.zone;
  const raw = typeof o.label === "string" ? o.label : "";
  // eslint-disable-next-line no-control-regex
  const label = raw.replace(/[<>"\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return {
    lat: clamp(o.lat, D.lat, { min: -85, max: 85 }, 6),
    lng: clamp(o.lng, D.lng, { min: -180, max: 180 }, 6),
    radius_m: clamp(o.radius_m, D.radius_m, BOUNDS.zone_radius_m),
    label: label || D.label,
  };
}

function clamp(v: unknown, d: number, b: Bound, decimals = 0): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return d;
  const f = 10 ** decimals;
  // Arrondi « half away from zero » comme PostgreSQL round(numeric)
  const r = Math.sign(v) * Math.round(Math.abs(v) * f) / f;
  return Math.min(b.max, Math.max(b.min, r));
}
function bool(v: unknown, d: boolean) {
  return typeof v === "boolean" ? v : d;
}
function oneOf<T extends string>(v: unknown, d: T, allowed: readonly T[]): T {
  return allowed.includes(v as T) ? (v as T) : d;
}

/** Normalise une configuration partielle (même résultat que le serveur). */
export function normalizeConfig(input: unknown): GameConfig {
  const c = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const r = (c.radar && typeof c.radar === "object" ? c.radar : {}) as Record<string, unknown>;
  const ab = (c.abilities && typeof c.abilities === "object" ? c.abilities : {}) as Record<string, unknown>;
  const D = DEFAULT_CONFIG;
  const abilities = {} as Record<AbilityKey, AbilityConfig>;
  for (const key of Object.keys(ABILITY_DEFAULTS) as AbilityKey[]) {
    const a = (ab[key] && typeof ab[key] === "object" ? ab[key] : {}) as Record<string, unknown>;
    const d = ABILITY_DEFAULTS[key];
    abilities[key] = {
      enabled: bool(a.enabled, true),
      duration_s: clamp(a.duration_s, d.duration_s, BOUNDS.ability_duration_s),
      cooldown_s: clamp(a.cooldown_s, d.cooldown_s, BOUNDS.ability_cooldown_s),
      max_uses: clamp(a.max_uses, d.max_uses, BOUNDS.ability_max_uses),
    };
  }
  return {
    mode: oneOf(c.mode, D.mode, ["classic", "infection"] as const),
    duration_s: clamp(c.duration_s, D.duration_s, BOUNDS.duration_s),
    prep_s: clamp(c.prep_s, D.prep_s, BOUNDS.prep_s),
    zone: normalizeZone(c.zone),
    forbidden_zones: bool(c.forbidden_zones, D.forbidden_zones),
    hunter_ratio: clamp(c.hunter_ratio, D.hunter_ratio, BOUNDS.hunter_ratio, 2),
    step_regen_ms: clamp(c.step_regen_ms, D.step_regen_ms, BOUNDS.step_regen_ms),
    max_steps: clamp(c.max_steps, D.max_steps, BOUNDS.max_steps),
    vision_hunter: clamp(c.vision_hunter, D.vision_hunter, BOUNDS.vision_hunter),
    vision_fugitive: clamp(c.vision_fugitive, D.vision_fugitive, BOUNDS.vision_fugitive),
    capture_range: clamp(c.capture_range, D.capture_range, BOUNDS.capture_range),
    capture_cooldown_s: clamp(c.capture_cooldown_s, D.capture_cooldown_s, BOUNDS.capture_cooldown_s),
    disconnect_grace_s: clamp(c.disconnect_grace_s, D.disconnect_grace_s, BOUNDS.disconnect_grace_s),
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
    abilities,
  };
}
/**
 * Préréglages proposés à l'hôte. Ils ne changent pas le lieu de la zone,
 * seulement son rayon (`zoneRadius`) et le rythme de la partie.
 */
export const PRESETS: {
  id: string;
  label: string;
  description: string;
  zoneRadius: number;
  config: Partial<GameConfig>;
}[] = [
  {
    id: "standard",
    label: "Standard",
    description: "15 min, zone de 600 m de rayon, radar toutes les 60 s.",
    zoneRadius: 600,
    config: {},
  },
  {
    id: "blitz",
    label: "Éclair",
    description: "6 min dans un quartier (350 m), radar fréquent.",
    zoneRadius: 350,
    config: { duration_s: 360, prep_s: 30, radar: { ...DEFAULT_CONFIG.radar, interval_s: 30 } },
  },
  {
    id: "marathon",
    label: "Longue traque",
    description: "30 min sur 1,2 km de rayon, radar plus rare mais précis.",
    zoneRadius: 1200,
    config: {
      duration_s: 1800,
      prep_s: 90,
      radar: { ...DEFAULT_CONFIG.radar, interval_s: 120, precision: "zone" },
    },
  },
];

/** Applique un préréglage en conservant le lieu choisi et les capacités. */
export function applyPreset(current: GameConfig, presetId: string): GameConfig {
  const p = PRESETS.find((x) => x.id === presetId);
  if (!p) return current;
  return normalizeConfig({
    ...p.config,
    mode: current.mode,
    abilities: current.abilities,
    forbidden_zones: current.forbidden_zones,
    zone: { ...current.zone, radius_m: p.zoneRadius },
  });
}
