/** Types partagés du jeu. Le serveur (PostgreSQL) reste l'autorité. */

export type Team = "hunter" | "fugitive";
export type GamePhase = "preparation" | "running" | "paused" | "finished";
export type RoomStatus = "lobby" | "playing" | "results" | "closed";
export type PlayerStatus = "active" | "captured" | "abandoned";
export type Winner = Team | "draw";
export type EndReason = "all_captured" | "time_up" | "hunters_left" | "fugitives_left" | "aborted" | "no_players";
export type GameMode = "classic" | "infection";
export type RadarPrecision = "direction" | "sector" | "zone";
export type AbilityKey = "ghost" | "jammer" | "sprint" | "scan" | "tracker" | "barrier";
export type Dir8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "here";
export type DistanceBand = "near" | "mid" | "far";

export interface MapData {
  w: number;
  h: number;
  /** '.' libre, '#' bâtiment, '~' zone interdite */
  rows: string[];
}

export interface Cell {
  x: number;
  y: number;
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
  map_size: "s" | "m" | "l";
  obstacle_density: number;
  forbidden_zones: boolean;
  hunter_ratio: number;
  step_regen_ms: number;
  max_steps: number;
  vision_hunter: number;
  vision_fugitive: number;
  capture_range: number;
  capture_cooldown_s: number;
  disconnect_grace_s: number;
  radar: RadarConfig;
  abilities: Record<AbilityKey, AbilityConfig>;
}

export type RadarContact =
  | { jammed: true }
  | { dir: Dir8; band: DistanceBand }
  | { sx: number; sy: number; size: number; cols: number }
  | { x0: number; y0: number; size: number };

export interface RadarPulse {
  i: number;
  kind: "auto" | "manual";
  precision: RadarPrecision;
  contacts: RadarContact[];
  origin: Cell;
  by: string | null;
  at: number;
  expires_at: number;
}

export interface Reveal {
  area: { x: number; y: number; r: number };
  contacts: { u: string; x: number; y: number }[];
  expires_at: number;
  by: string;
}

export interface MapEffect {
  id: string;
  kind: "blocked";
  x: number;
  y: number;
  expires_at: number;
}

export interface GameEvent<T = Record<string, unknown>> {
  /** flux : all | hunter | fugitive | p:<uid> */
  s: string;
  sn: number;
  t: string;
  d: T;
  at: number;
}
