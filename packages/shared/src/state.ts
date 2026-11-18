/**
 * État client d'une partie GPS : construit depuis get_game_view
 * (resynchronisation) puis mis à jour événement par événement. Pur.
 */
import type {
  AbilityKey,
  DeviceFix,
  EndReason,
  GameConfig,
  GameEvent,
  GameMode,
  GamePhase,
  GameZone,
  LatLng,
  PlayerStatus,
  RadarPulse,
  Reveal,
  SharedPosition,
  Team,
  Winner,
} from "./types";

export interface PlayerInfo {
  u: string;
  username: string;
  avatar: string;
  team: Team;
  status: PlayerStatus;
  connected: boolean;
  captures: number;
  out_of_zone: boolean;
}

export interface MeState {
  u: string;
  team: Team;
  initial_team: Team;
  status: PlayerStatus;
  lat: number | null;
  lng: number | null;
  acc: number | null;
  pos_at: number | null;
  out_of_zone_since: number | null;
  ghost_until: number | null;
  jam_until: number | null;
  decoy_until: number | null;
  last_capture_at: number | null;
  captures: number;
  distance_m: number;
}

export interface GameInfo {
  id: string;
  room_id: string;
  mode: GameMode;
  phase: GamePhase;
  config: GameConfig;
  zone: GameZone;
  started_at: number;
  running_at: number | null;
  phase_started_at: number;
  phase_ends_at: number | null;
  paused_from: GamePhase | null;
  paused_remaining_ms: number | null;
  next_radar_at: number | null;
  ended_at: number | null;
  winner: Winner | null;
  end_reason: EndReason | null;
  radar_state: { radar_last?: number; radar_uses?: number };
}

export interface FinalEntry {
  u: string;
  team: Team;
  initial_team: Team;
  status: PlayerStatus;
  outcome: "win" | "loss" | "draw";
  score: number;
  captures: number;
  survival_seconds: number;
  distance?: number;
}

export interface GameView {
  server_now: number;
  game: GameInfo;
  room: { id: string; code: string; name: string; host_id: string };
  me: MeState;
  players: PlayerInfo[];
  allies: SharedPosition[];
  enemies: SharedPosition[];
  cooldowns: Partial<Record<AbilityKey, { last_used_at: number; uses: number; until: number | null }>>;
  radar: RadarPulse | null;
  reveals: Reveal[];
  streams: { all: number; team: number; p: number };
  events: GameEvent[];
  final: FinalEntry[] | null;
  team_topic?: string;
}

export interface Hint {
  kind: "tracker" | "sonar";
  data: Record<string, unknown>;
  at: number;
}

export interface GameState {
  view: GameView;
  game: GameInfo;
  me: MeState;
  /** dernière position de l'appareil (affichage immédiat, non autoritaire) */
  device: DeviceFix | null;
  players: Record<string, PlayerInfo>;
  allies: Record<string, SharedPosition>;
  enemies: Record<string, SharedPosition>;
  cooldowns: GameView["cooldowns"];
  radar: RadarPulse | null;
  radarPings: number[];
  reveals: Reveal[];
  hint: Hint | null;
  journal: GameEvent[];
  final: FinalEntry[] | null;
  needsResync: boolean;
}

const JOURNAL_TYPES = new Set([
  "phase_changed", "player_status", "capture", "capture_missed", "radar", "radar_ping", "reveal", "tracker",
  "sonar", "ability", "alert", "game_finished", "team_changed", "zone_status", "position_withdrawn",
]);
const JOURNAL_MAX = 80;

export function streamsFor(view: Pick<GameView, "me" | "streams">): Record<string, number> {
  return { all: view.streams.all, [view.me.team]: view.streams.team, [`p:${view.me.u}`]: view.streams.p };
}

const byUser = (list: SharedPosition[]) => Object.fromEntries(list.map((p) => [p.u, p]));

export function fromView(view: GameView, device: DeviceFix | null = null): GameState {
  return {
    view,
    game: view.game,
    me: view.me,
    device,
    players: Object.fromEntries(view.players.map((p) => [p.u, p])),
    allies: byUser(view.allies),
    enemies: byUser(view.enemies),
    cooldowns: view.cooldowns ?? {},
    radar: view.radar,
    radarPings: [],
    reveals: view.reveals ?? [],
    hint: null,
    journal: view.events.filter((e) => JOURNAL_TYPES.has(e.t)).slice(-JOURNAL_MAX),
    final: view.final,
    needsResync: false,
  };
}

// Charges utiles dynamiques (format défini par le serveur, migration 0800).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D = Record<string, any>;

export function applyEvent(s: GameState, ev: GameEvent): GameState {
  const d = ev.d as D;
  const next: GameState = {
    ...s,
    journal: JOURNAL_TYPES.has(ev.t) ? [...s.journal, ev].slice(-JOURNAL_MAX) : s.journal,
  };
  switch (ev.t) {
    case "phase_changed":
      next.game = {
        ...s.game,
        phase: d.phase,
        phase_started_at: d.phase_started_at,
        phase_ends_at: d.phase_ends_at,
        paused_from: d.paused_from,
        paused_remaining_ms: d.paused_remaining_ms,
        next_radar_at: d.next_radar_at,
        running_at: d.running_at ?? s.game.running_at,
      };
      if (s.game.phase === "paused" && d.phase !== "paused") next.needsResync = true;
      break;
    case "pos":
      if (d.u !== s.me.u) next.allies = { ...s.allies, [d.u]: d as SharedPosition };
      break;
    case "enemy_pos":
      next.enemies = { ...s.enemies, [d.u]: d as SharedPosition };
      break;
    case "position_withdrawn": {
      const allies = { ...s.allies };
      const enemies = { ...s.enemies };
      delete allies[d.u];
      delete enemies[d.u];
      next.allies = allies;
      next.enemies = enemies;
      break;
    }
    case "zone_status": {
      const p = s.players[d.u];
      if (p) next.players = { ...s.players, [d.u]: { ...p, out_of_zone: !!d.out } };
      if (d.u === s.me.u) next.me = { ...s.me, out_of_zone_since: d.out ? d.at : null };
      break;
    }
    case "player_status": {
      const p = s.players[d.u];
      if (p) next.players = { ...s.players, [d.u]: { ...p, status: d.status, connected: d.connected } };
      if (d.u === s.me.u) next.me = { ...s.me, status: d.status };
      if (d.status !== "active") {
        const enemies = { ...s.enemies };
        const allies = { ...s.allies };
        delete enemies[d.u];
        delete allies[d.u];
        next.enemies = enemies;
        next.allies = allies;
      }
      break;
    }
    case "capture": {
      const players = { ...s.players };
      if (players[d.f]) players[d.f] = d.infected ? { ...players[d.f], team: "hunter" } : { ...players[d.f], status: "captured" };
      if (d.h && players[d.h]) players[d.h] = { ...players[d.h], captures: players[d.h].captures + 1 };
      next.players = players;
      const enemies = { ...s.enemies };
      const allies = { ...s.allies };
      delete enemies[d.f];
      delete allies[d.f];
      next.enemies = enemies;
      next.allies = allies;
      if (d.f === s.me.u && !d.infected) next.me = { ...s.me, status: "captured" };
      if (d.h === s.me.u) next.me = { ...(next.me ?? s.me), captures: s.me.captures + 1 };
      if (d.infected && s.me.team === "fugitive") next.needsResync = true;
      break;
    }
    case "team_changed":
      next.needsResync = true;
      break;
    case "radar":
      next.radar = d as RadarPulse;
      break;
    case "radar_ping":
      next.radarPings = [...s.radarPings.slice(-4), d.at as number];
      break;
    case "reveal":
      next.reveals = [...s.reveals, d as Reveal];
      break;
    case "tracker":
    case "sonar":
      next.hint = { kind: ev.t, data: d, at: ev.at };
      break;
    case "ability": {
      const field = ({ ghost: "ghost_until", jammer: "jam_until", decoy: "decoy_until" } as const)[d.key as "ghost"];
      if (field && d.u === s.me.u) next.me = { ...s.me, [field]: d.until };
      break;
    }
    case "game_finished":
      next.game = { ...s.game, phase: "finished", winner: d.winner, end_reason: d.reason, ended_at: d.ended_at, phase_ends_at: null };
      next.final = d.players as FinalEntry[];
      break;
    default:
      break;
  }
  return next;
}

export function withDevice(s: GameState, fix: DeviceFix): GameState {
  return { ...s, device: fix };
}

export function pruneExpired(s: GameState, now: number): GameState {
  const reveals = s.reveals.filter((r) => r.expires_at > now);
  const radar = s.radar && s.radar.expires_at > now ? s.radar : null;
  const hint = s.hint && now - s.hint.at < 20_000 ? s.hint : null;
  if (reveals.length === s.reveals.length && radar === s.radar && hint === s.hint) return s;
  return { ...s, reveals, radar, hint };
}

/** Position à afficher pour « moi » : l'appareil si disponible, sinon la dernière connue du serveur. */
export function myDisplayPosition(s: GameState): (LatLng & { acc: number | null }) | null {
  if (s.device) return { lat: s.device.lat, lng: s.device.lng, acc: s.device.accuracy };
  if (s.me.lat != null && s.me.lng != null) return { lat: s.me.lat, lng: s.me.lng, acc: s.me.acc };
  return null;
}
