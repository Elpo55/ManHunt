/**
 * État client d'une partie : construit depuis get_game_view (resynchronisation
 * complète) puis mis à jour événement par événement. Fonctions pures.
 */
import type {
  AbilityKey,
  Cell,
  GameConfig,
  GameEvent,
  GamePhase,
  MapData,
  MapEffect,
  PlayerStatus,
  RadarPulse,
  Reveal,
  Team,
  Winner,
  EndReason,
  GameMode,
  DistanceBand,
  Dir8,
} from "../engine/types";

export interface PlayerInfo {
  u: string;
  username: string;
  avatar: string;
  team: Team;
  status: PlayerStatus;
  connected: boolean;
  captures: number;
}

export interface AllyState {
  u: string;
  x: number;
  y: number;
  team: Team;
  status: PlayerStatus;
  ghost_until: number | null;
  boost_until: number | null;
  jam_until: number | null;
}

export interface MeState {
  u: string;
  team: Team;
  initial_team: Team;
  status: PlayerStatus;
  x: number;
  y: number;
  steps: number;
  steps_at: number;
  ghost_until: number | null;
  jam_until: number | null;
  boost_until: number | null;
  last_capture_at: number | null;
  captures: number;
}

export interface GameInfo {
  id: string;
  room_id: string;
  mode: GameMode;
  phase: GamePhase;
  config: GameConfig;
  map: MapData;
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
  x?: number;
  y?: number;
}

export interface TrackerHint {
  dir?: Dir8;
  band?: DistanceBand;
  jammed?: boolean;
  none?: boolean;
  origin: Cell;
  by: string;
  at: number;
}

export interface GameView {
  server_now: number;
  game: GameInfo;
  room: { id: string; code: string; name: string; host_id: string };
  me: MeState;
  players: PlayerInfo[];
  allies: AllyState[];
  visible: { u: string; x: number; y: number }[];
  effects: MapEffect[];
  cooldowns: Partial<Record<AbilityKey, { last_used_at: number; uses: number; until: number | null }>>;
  radar: RadarPulse | null;
  reveals: Reveal[];
  streams: { all: number; team: number; p: number };
  events: GameEvent[];
  final: FinalEntry[] | null;
  /** topic Realtime courant de l'équipe (rotation en mode Infection) */
  team_topic?: string;
}

export interface GameState {
  view: GameView;
  players: Record<string, PlayerInfo>;
  allies: Record<string, AllyState>;
  me: MeState;
  visible: { u: string; x: number; y: number }[];
  effects: MapEffect[];
  cooldowns: GameView["cooldowns"];
  radar: RadarPulse | null;
  radarPings: number[];
  reveals: Reveal[];
  tracker: TrackerHint | null;
  journal: GameEvent[];
  trails: Record<string, Cell[]>;
  final: FinalEntry[] | null;
  game: GameInfo;
  /** vrai si l'événement impose une resynchronisation complète (changement d'équipe…) */
  needsResync: boolean;
}

const JOURNAL_TYPES = new Set([
  "phase_changed",
  "player_status",
  "capture",
  "capture_missed",
  "map_effect",
  "radar",
  "radar_ping",
  "reveal",
  "tracker",
  "ability",
  "alert",
  "game_finished",
  "team_changed",
]);
const JOURNAL_MAX = 80;
const TRAIL_MAX = 16;

export function streamsFor(view: Pick<GameView, "me" | "streams">): Record<string, number> {
  return { all: view.streams.all, [view.me.team]: view.streams.team, [`p:${view.me.u}`]: view.streams.p };
}

export function fromView(view: GameView): GameState {
  const players: Record<string, PlayerInfo> = {};
  for (const p of view.players) players[p.u] = p;
  const allies: Record<string, AllyState> = {};
  for (const a of view.allies) allies[a.u] = a;
  return {
    view,
    players,
    allies,
    me: view.me,
    visible: view.visible,
    effects: view.effects,
    cooldowns: view.cooldowns ?? {},
    radar: view.radar,
    radarPings: [],
    reveals: view.reveals ?? [],
    tracker: null,
    journal: view.events.filter((e) => JOURNAL_TYPES.has(e.t)).slice(-JOURNAL_MAX),
    trails: {},
    final: view.final,
    game: view.game,
    needsResync: false,
  };
}

function pushJournal(s: GameState, ev: GameEvent): GameEvent[] {
  if (!JOURNAL_TYPES.has(ev.t)) return s.journal;
  const j = [...s.journal, ev];
  return j.length > JOURNAL_MAX ? j.slice(j.length - JOURNAL_MAX) : j;
}

// Charges utiles dynamiques (format défini par le serveur, cf. migration 0500).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D = Record<string, any>;

export function applyEvent(s: GameState, ev: GameEvent): GameState {
  const d = ev.d as D;
  const next: GameState = { ...s, journal: pushJournal(s, ev) };

  switch (ev.t) {
    case "phase_changed": {
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
      if (s.game.phase === "paused" && d.phase !== "paused") {
        // Le serveur décale les effets de la durée de pause : on se resynchronise.
        next.needsResync = true;
      }
      break;
    }
    case "move": {
      const a = s.allies[d.u];
      if (a) {
        next.allies = { ...s.allies, [d.u]: { ...a, x: d.x, y: d.y } };
        const trail = [...(s.trails[d.u] ?? []), ...((d.p as number[][]) ?? []).map(([x, y]) => ({ x, y }))];
        next.trails = { ...s.trails, [d.u]: trail.slice(-TRAIL_MAX) };
      }
      if (d.u === s.me.u) next.me = { ...s.me, x: d.x, y: d.y };
      break;
    }
    case "vis":
      next.visible = d.enemies ?? [];
      break;
    case "player_status": {
      const p = s.players[d.u];
      if (p) next.players = { ...s.players, [d.u]: { ...p, status: d.status, connected: d.connected } };
      const a = s.allies[d.u];
      if (a) next.allies = { ...s.allies, [d.u]: { ...a, status: d.status } };
      if (d.u === s.me.u) next.me = { ...s.me, status: d.status };
      break;
    }
    case "capture": {
      const players = { ...s.players };
      if (players[d.f]) {
        players[d.f] = d.infected
          ? { ...players[d.f], team: "hunter" }
          : { ...players[d.f], status: "captured" };
      }
      if (players[d.h]) players[d.h] = { ...players[d.h], captures: players[d.h].captures + 1 };
      next.players = players;
      if (s.allies[d.f]) {
        const allies = { ...s.allies };
        if (d.infected) delete allies[d.f];
        else allies[d.f] = { ...allies[d.f], status: "captured" };
        next.allies = allies;
      }
      next.visible = s.visible.filter((v) => v.u !== d.f);
      // Infection : le topic Fugitif change, les Fugitifs se resynchronisent.
      if (d.infected && s.me.team === "fugitive") next.needsResync = true;
      if (d.f === s.me.u && !d.infected) next.me = { ...s.me, status: "captured" };
      if (d.h === s.me.u) next.me = { ...(next.me ?? s.me), captures: s.me.captures + 1 };
      break;
    }
    case "team_changed":
      next.needsResync = true;
      break;
    case "map_effect":
      next.effects = [...s.effects.filter((e) => e.id !== d.id), d as MapEffect];
      break;
    case "map_effect_removed":
      next.effects = s.effects.filter((e) => e.id !== d.id);
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
      next.tracker = { ...(d as Omit<TrackerHint, "at">), at: ev.at } as TrackerHint;
      break;
    case "ability": {
      const field = ({ ghost: "ghost_until", sprint: "boost_until", jammer: "jam_until" } as const)[
        d.key as "ghost" | "sprint" | "jammer"
      ];
      if (field && s.allies[d.u]) next.allies = { ...s.allies, [d.u]: { ...s.allies[d.u], [field]: d.until } };
      if (field && d.u === s.me.u) next.me = { ...s.me, [field]: d.until };
      break;
    }
    case "game_finished": {
      next.game = { ...s.game, phase: "finished", winner: d.winner, end_reason: d.reason, ended_at: d.ended_at, phase_ends_at: null };
      next.final = d.players as FinalEntry[];
      // Révélation finale : toutes les positions deviennent visibles.
      const allies: Record<string, AllyState> = {};
      for (const p of d.players as FinalEntry[]) {
        allies[p.u] = {
          u: p.u,
          x: p.x ?? 0,
          y: p.y ?? 0,
          team: p.team,
          status: p.status,
          ghost_until: null,
          boost_until: null,
          jam_until: null,
        };
      }
      next.allies = allies;
      next.visible = [];
      break;
    }
    default:
      break;
  }
  return next;
}

/** Applique des résultats d'actions locales (réponses RPC) sans attendre le broadcast. */
export function applyMoveResult(s: GameState, r: { x: number; y: number; steps: number; steps_at: number }): GameState {
  const me = { ...s.me, x: r.x, y: r.y, steps: r.steps, steps_at: r.steps_at };
  const allies = s.allies[s.me.u] ? { ...s.allies, [s.me.u]: { ...s.allies[s.me.u], x: r.x, y: r.y } } : s.allies;
  return { ...s, me, allies };
}

export function pruneExpired(s: GameState, now: number): GameState {
  const reveals = s.reveals.filter((r) => r.expires_at > now);
  const effects = s.effects.filter((e) => e.expires_at > now);
  const radar = s.radar && s.radar.expires_at > now ? s.radar : null;
  const tracker = s.tracker && now - s.tracker.at < 15_000 ? s.tracker : null;
  if (
    reveals.length === s.reveals.length &&
    effects.length === s.effects.length &&
    radar === s.radar &&
    tracker === s.tracker
  )
    return s;
  return { ...s, reveals, effects, radar, tracker };
}
