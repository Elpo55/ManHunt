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

/** Cercle de zone (Royale : zone courante / prochaine). */
export interface ZoneCircle extends LatLng {
  radius_m: number;
}

export interface RoyaleState {
  current: ZoneCircle | null;
  next: ZoneCircle | null;
  next_at: number | null;
  stage: number;
  stages: number;
  warn_s: number;
}

export interface MisterXReveal {
  u: string;
  lat?: number;
  lng?: number;
  acc?: number;
  lost?: boolean;
  at: number;
}

export interface Objective {
  idx: number;
  kind: "beacon" | "extraction";
  lat: number;
  lng: number;
  label: string;
  radius_m: number;
  claimed_by: string | null;
  claimed_at: number | null;
}

export type MarkerKind = "enemy" | "danger" | "meet" | "objective" | "info";
export interface TeamMarker {
  id: string;
  u: string;
  kind: MarkerKind;
  lat: number;
  lng: number;
  expires_at: number;
}

export interface SosInfo {
  u: string;
  username: string;
  message: string;
  at: number;
  lat: number | null;
  lng: number | null;
  acc: number | null;
}

/** État d'un appareil coéquipier (fourni par son OS, rafraîchi par le heartbeat). */
export interface DeviceHealth {
  battery: number | null;
  app: "foreground" | "background" | null;
  gps: "ok" | "searching" | "denied" | "off" | null;
  at: number | null;
  last_pos_at?: number | null;
  gps_silent_since?: number | null;
}

/** Extensions v0.4.0 de get_game_view (absentes d'un serveur plus ancien). */
export interface GameExtras {
  zone: RoyaleState | null;
  misterx: { u: string; next_at: number | null; last: MisterXReveal | null } | null;
  objectives: Objective[];
  extraction_open: boolean;
  markers: TeamMarker[];
  sos: SosInfo | null;
  health: Record<string, DeviceHealth>;
  silent: string[];
  me: { objectives: number; extracted_at: number | null; gps_silent_since: number | null };
}

export const EMPTY_EXTRAS: GameExtras = {
  zone: null,
  misterx: null,
  objectives: [],
  extraction_open: false,
  markers: [],
  sos: null,
  health: {},
  silent: [],
  me: { objectives: 0, extracted_at: null, gps_silent_since: null },
};

export interface TeamMessage {
  u: string;
  code: string;
  at: number;
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
  ext?: GameExtras;
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
  ext: GameExtras;
  /** derniers messages rapides de l'équipe */
  teamMessages: TeamMessage[];
  /** succès débloqués pendant cette session (affichage) */
  achievements: string[];
}

const JOURNAL_TYPES = new Set([
  "phase_changed", "player_status", "capture", "capture_missed", "radar", "radar_ping", "reveal", "tracker",
  "sonar", "ability", "alert", "game_finished", "team_changed", "zone_status", "position_withdrawn",
  "zone_next", "zone_shrink", "misterx_reveal", "misterx_revealed", "objective_claimed", "extracted", "extraction_open",
  "team_msg", "sos", "sos_resolved", "gps_silent", "admin_action", "achievement",
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
    ext: { ...EMPTY_EXTRAS, ...(view.ext ?? {}) },
    teamMessages: view.events.filter((e) => e.t === "team_msg").slice(-6).map((e) => e.d as unknown as TeamMessage),
    achievements: [],
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
        next.needsResync = true; // canal d'équipe renouvelé
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
      // Toute capture fait changer le canal privé de l'équipe concernée (v0.4.0) :
      // resynchronisation pour obtenir le nouveau topic.
      next.needsResync = true;
      break;
    }
    case "zone_next":
    case "zone_shrink":
      next.ext = { ...s.ext, zone: d as RoyaleState };
      break;
    case "misterx_reveal":
      next.ext = { ...s.ext, misterx: { u: d.u, next_at: d.next_at ?? null, last: d as MisterXReveal } };
      break;
    case "misterx_revealed":
      if (s.ext.misterx) next.ext = { ...s.ext, misterx: { ...s.ext.misterx, next_at: d.next_at ?? null } };
      break;
    case "objective_claimed":
      next.ext = {
        ...s.ext,
        objectives: s.ext.objectives.map((o) => (o.idx === d.idx && o.kind === "beacon" ? { ...o, claimed_by: d.u, claimed_at: ev.at } : o)),
        me: d.u === s.me.u ? { ...s.ext.me, objectives: s.ext.me.objectives + 1 } : s.ext.me,
      };
      break;
    case "extracted":
      if (d.u === s.me.u) next.ext = { ...s.ext, me: { ...s.ext.me, extracted_at: ev.at } };
      break;
    case "extraction_open":
      next.ext = { ...s.ext, extraction_open: true };
      break;
    case "marker":
      next.ext = { ...s.ext, markers: [...s.ext.markers.filter((m) => m.id !== d.id), d as TeamMarker] };
      break;
    case "marker_removed":
      next.ext = { ...s.ext, markers: s.ext.markers.filter((m) => m.id !== d.id) };
      break;
    case "team_msg":
      next.teamMessages = [...s.teamMessages.slice(-5), d as TeamMessage];
      break;
    case "sos":
      next.ext = { ...s.ext, sos: d as SosInfo };
      break;
    case "sos_resolved":
      next.ext = { ...s.ext, sos: null };
      break;
    case "health":
      next.ext = { ...s.ext, health: { ...s.ext.health, [d.u]: { ...s.ext.health[d.u], battery: d.battery, app: d.app, gps: d.gps, at: d.at } } };
      break;
    case "gps_silent":
      next.ext = {
        ...s.ext,
        silent: [...s.ext.silent.filter((u) => u !== d.u), d.u],
        me: d.u === s.me.u ? { ...s.ext.me, gps_silent_since: ev.at } : s.ext.me,
      };
      break;
    case "gps_ok":
      next.ext = {
        ...s.ext,
        silent: s.ext.silent.filter((u) => u !== d.u),
        me: d.u === s.me.u ? { ...s.ext.me, gps_silent_since: null } : s.ext.me,
      };
      break;
    case "achievement":
      next.achievements = [...s.achievements, d.key];
      break;
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
  const markers = s.ext.markers.filter((m) => m.expires_at > now);
  if (reveals.length === s.reveals.length && radar === s.radar && hint === s.hint && markers.length === s.ext.markers.length) return s;
  return { ...s, reveals, radar, hint, ext: markers.length === s.ext.markers.length ? s.ext : { ...s.ext, markers } };
}

/** Position à afficher pour « moi » : l'appareil si disponible, sinon la dernière connue du serveur. */
export function myDisplayPosition(s: GameState): (LatLng & { acc: number | null }) | null {
  if (s.device) return { lat: s.device.lat, lng: s.device.lng, acc: s.device.accuracy };
  if (s.me.lat != null && s.me.lng != null) return { lat: s.me.lat, lng: s.me.lng, acc: s.me.acc };
  return null;
}
