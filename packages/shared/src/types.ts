/** Types partagés du jeu géolocalisé. Le serveur (PostgreSQL) reste l'autorité. */

export type Team = "hunter" | "fugitive";
export type GamePhase = "preparation" | "running" | "paused" | "finished";
export type RoomStatus = "lobby" | "playing" | "results" | "closed";
export type PlayerStatus = "active" | "captured" | "abandoned";
export type Winner = Team | "draw";
export type EndReason = "all_captured" | "time_up" | "hunters_left" | "fugitives_left" | "aborted" | "no_players" | "objectives";
export type GameMode = "classic" | "infection" | "royale" | "misterx";
export type CaptureMethod = "gps" | "qr" | "both";
export type RadarPrecision = "direction" | "sector" | "zone";
export type AbilityKey = "ghost" | "jammer" | "decoy" | "scan" | "tracker" | "sonar";
export type Dir8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type DistanceBand = "near" | "mid" | "far";
export type EnemyReveal = "live" | "pulse";

export interface LatLng {
  lat: number;
  lng: number;
}

export type ForbiddenZone =
  | { kind: "circle"; lat: number; lng: number; radius_m: number; label: string }
  | { kind: "polygon"; points: LatLng[]; label: string };

/**
 * Zone de jeu réelle choisie par l'hôte. `set` = validée par l'hôte.
 * Forme : cercle (centre + rayon) ou polygone (le cercle sert alors de cadrage).
 * À l'intérieur d'une zone interdite, le joueur est « hors zone ».
 */
export interface GameZone extends LatLng {
  radius_m: number;
  label: string;
  set: boolean;
  shape: "circle" | "polygon";
  polygon: LatLng[];
  forbidden: ForbiddenZone[];
}

/** Lieu choisi par l'hôte (point de rendez-vous, extraction). */
export interface GamePlace extends LatLng {
  set: boolean;
  label: string;
}

export interface RoyaleConfig {
  stages: number;
  final_ratio: number;
  warn_s: number;
}

export interface ObjectivesConfig {
  enabled: boolean;
  radius_m: number;
  points_each: number;
  win_on_all: boolean;
  beacons: (LatLng & { label: string })[];
  extraction: GamePlace;
  extraction_open_s: number;
  extraction_bonus: number;
}

export interface AbilityConfig {
  enabled: boolean;
  duration_s: number;
  cooldown_s: number;
  max_uses: number;
}

export interface RadarConfig {
  enabled: boolean;
  mode: "auto" | "manual";
  interval_s: number;
  precision: RadarPrecision;
  teams: Team | "both";
  cooldown_s: number;
  reveal_s: number;
  max_uses: number;
}

export interface GameConfig {
  mode: GameMode;
  duration_s: number;
  prep_s: number;
  zone: GameZone;
  hunter_ratio: number;
  position_interval_s: number;
  enemy_reveal: EnemyReveal;
  enemy_refresh_s: number;
  approx_m: number;
  stale_after_s: number;
  capture_radius_m: number;
  capture_cooldown_s: number;
  capture_method: CaptureMethod;
  max_accuracy_m: number;
  max_speed_mps: number;
  out_of_zone_grace_s: number;
  disconnect_grace_s: number;
  gps_silent_s: number;
  radar: RadarConfig;
  royale: RoyaleConfig;
  misterx: { reveal_interval_s: number };
  objectives: ObjectivesConfig;
  spectators: { enabled: boolean; delay_s: number };
  replay: { enabled: boolean };
  rendezvous: GamePlace;
  abilities: Record<AbilityKey, AbilityConfig>;
}

/** Position diffusée par le serveur (toujours arrondie pour les autres joueurs). */
export interface SharedPosition {
  u: string;
  lat?: number;
  lng?: number;
  /** précision affichable en mètres (>= précision GPS réelle) */
  acc?: number;
  /** horodatage serveur (ms) */
  at: number;
  /** position masquée (capacité Fantôme) */
  hidden?: boolean;
}

export type RadarContact =
  | { lost: true }
  | { jammed: true }
  | { dir: Dir8; band: DistanceBand; dist_m: number }
  | { sector: number; ring: 0 | 1 }
  | { lat: number; lng: number; r_m: number };

export interface RadarPulse {
  i: number;
  kind: "auto" | "manual";
  precision: RadarPrecision;
  contacts: RadarContact[];
  origin: LatLng | null;
  by: string | null;
  at: number;
  expires_at: number;
}

export interface Reveal {
  center: LatLng;
  radius_m: number;
  contacts: SharedPosition[];
  expires_at: number;
  by: string;
}

export interface GameEvent<T = Record<string, unknown>> {
  /** flux : all | hunter | fugitive | p:<uid> */
  s: string;
  sn: number;
  t: string;
  d: T;
  at: number;
}

/** Position fournie par le GPS de l'appareil. */
export interface DeviceFix extends LatLng {
  accuracy: number;
  /** horodatage de la mesure (ms, horloge de l'appareil) */
  timestamp: number;
  speed?: number | null;
  heading?: number | null;
}
