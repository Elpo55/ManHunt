/** Types partagés du jeu géolocalisé. Le serveur (PostgreSQL) reste l'autorité. */

export type Team = "hunter" | "fugitive";
export type GamePhase = "preparation" | "running" | "paused" | "finished";
export type RoomStatus = "lobby" | "playing" | "results" | "closed";
export type PlayerStatus = "active" | "captured" | "abandoned";
export type Winner = Team | "draw";
export type EndReason = "all_captured" | "time_up" | "hunters_left" | "fugitives_left" | "aborted" | "no_players";
export type GameMode = "classic" | "infection";
export type RadarPrecision = "direction" | "sector" | "zone";
export type AbilityKey = "ghost" | "jammer" | "decoy" | "scan" | "tracker" | "sonar";
export type Dir8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type DistanceBand = "near" | "mid" | "far";
export type EnemyReveal = "live" | "pulse";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Zone de jeu réelle : cercle choisi par l'hôte. `set` = validée par l'hôte. */
export interface GameZone extends LatLng {
  radius_m: number;
  label: string;
  set: boolean;
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
  max_accuracy_m: number;
  max_speed_mps: number;
  out_of_zone_grace_s: number;
  disconnect_grace_s: number;
  radar: RadarConfig;
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
