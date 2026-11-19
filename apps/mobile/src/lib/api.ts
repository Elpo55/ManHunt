/** Appels serveur typés. Le client ne modifie jamais directement l'état du jeu. */
import {
  AppError,
  normalizeConfig,
  toAppError,
  type AbilityKey,
  type CaptureToken,
  type DeviceFix,
  type GameApi,
  type GameConfig,
  type GameView,
  type HealthReport,
  type MarkerKind,
  type Team,
} from "@traque/shared";
import { APP_VERSION } from "./env";
import { getSupabase } from "./supabase";

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new AppError("E_NOT_CONFIGURED");
  let res;
  try {
    res = await sb.rpc(fn, args);
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) {
    const err = toAppError(res.error);
    // Erreur inattendue : remontée (anonymisée, limitée) au tableau de bord d'administration.
    if (err.code === "E_INTERNAL" && fn !== "log_client_error") {
      void sb.rpc("log_client_error", { p_code: err.code, p_context: `${fn}: ${err.message}`.slice(0, 300), p_app_version: APP_VERSION }).then(
        () => undefined,
        () => undefined,
      );
    }
    throw err;
  }
  const data = res.data as { error?: unknown } | null;
  if (data && typeof data === "object" && typeof data.error === "string") throw new AppError(data.error);
  return res.data as T;
}

export interface Profile {
  id: string;
  username: string | null;
  avatar: string;
  is_guest: boolean;
  is_admin: boolean;
  role?: Role;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  captures: number;
  times_captured: number;
  survival_seconds: number;
  total_score: number;
}

export type Role = "owner" | "admin" | "moderator" | "player";
export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, moderator: 2, player: 1 };
export const ROLE_LABEL: Record<Role, string> = { owner: "Propriétaire", admin: "Administrateur", moderator: "Modérateur", player: "Joueur" };

export interface Release {
  version: string;
  build: number;
  severity: "optional" | "recommended" | "critical";
  min_supported_build: number | null;
  url: string | null;
  notes: string;
  published_at: number;
}

export interface AppSettings {
  limits?: { max_players: number; max_rooms_per_user?: number };
  defaults?: { duration_s: number; prep_s: number; max_players: number };
  features?: Record<string, boolean>;
  notifications?: { proximity_m: number; min_interval_s: number };
  announcement?: { text: string; level: "info" | "warn" };
}

export interface Achievement {
  key: string;
  name: string;
  description: string;
  threshold: number;
  progress: number;
  unlocked_at: number | null;
}

export interface ModeStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  captures: number;
  objectives: number;
  avg_survival_s: number;
  as_hunter: number;
  as_fugitive: number;
}

export interface SavedConfig {
  id: string;
  name: string;
  config: GameConfig;
  updated_at: string;
}

export interface ReplayData {
  started_at: number;
  ended_at: number;
  zone: GameConfig["zone"];
  tracks: { u: string; team: Team; username: string; points: { lat: number; lng: number; t: number }[] }[];
  events: { t: string; d: Record<string, unknown>; at: number }[];
}

export interface SpectatorView {
  delay_s: number;
  as_of: number;
  players: { u: string; team: Team; status: string; lat?: number; lng?: number; at?: number }[];
}

// Réponses d'administration (format libre défini par les RPC admin_*).
export type AdminJson = Record<string, any>;

export interface RoomMember {
  user_id: string;
  username: string;
  avatar: string;
  team: Team | null;
  is_ready: boolean;
  is_host: boolean;
  is_guest: boolean;
  location_consent: boolean;
  last_seen_at: string;
}

export interface RoomState {
  server_now: number;
  room: {
    id: string;
    code: string;
    name: string;
    host_id: string;
    status: "lobby" | "playing" | "results" | "closed";
    config: GameConfig;
    allow_team_choice: boolean;
    max_players: number;
    current_game_id: string | null;
  };
  members: RoomMember[];
  game: { id: string; phase: string; winner: string | null; participant: boolean } | null;
}

export interface MyRoom {
  id: string;
  code: string;
  name: string;
  status: string;
  is_host: boolean;
  current_game_id: string | null;
  members: number;
}

export interface LeaderboardRow {
  id: string;
  username: string;
  avatar: string;
  games_played: number;
  wins: number;
  captures: number;
  total_score: number;
  win_rate: number;
}

export const api = {
  updateProfile: (username: string, avatar: string) => rpc<Profile>("update_my_profile", { p_username: username, p_avatar: avatar }),
  createRoom: (name: string, config: Partial<GameConfig>, maxPlayers: number, allowTeamChoice: boolean) =>
    rpc<{ room_id: string; code: string }>("create_room", { p_name: name, p_config: config, p_max_players: maxPlayers, p_allow_team_choice: allowTeamChoice }),
  joinRoom: (code: string) => rpc<{ room_id: string; code: string }>("join_room", { p_code: code }),
  leaveRoom: (room: string) => rpc<void>("leave_room", { p_room: room }),
  kick: (room: string, user: string, ban: boolean) => rpc<void>("kick_member", { p_room: room, p_user: user, p_ban: ban }),
  setMemberTeam: (room: string, user: string, team: Team | null) => rpc<void>("set_member_team", { p_room: room, p_user: user, p_team: team }),
  chooseTeam: (room: string, team: Team | null) => rpc<void>("choose_team", { p_room: room, p_team: team }),
  autoAssign: (room: string) => rpc<void>("auto_assign_teams", { p_room: room }),
  updateRoomSettings: (room: string, s: { name?: string; config?: Partial<GameConfig>; maxPlayers?: number; allowTeamChoice?: boolean }) =>
    rpc<GameConfig>("update_room_settings", {
      p_room: room, p_name: s.name ?? null, p_config: s.config ?? null, p_max_players: s.maxPlayers ?? null, p_allow_team_choice: s.allowTeamChoice ?? null,
    }),
  transferHost: (room: string, user: string) => rpc<void>("transfer_host", { p_room: room, p_user: user }),
  setReady: (room: string, ready: boolean) => rpc<void>("set_ready", { p_room: room, p_ready: ready }),
  setConsent: (room: string, consent: boolean) => rpc<void>("set_location_consent", { p_room: room, p_consent: consent }),
  roomHeartbeat: (room: string) => rpc<{ server_now: number }>("room_heartbeat", { p_room: room }),
  roomState: (room: string) => rpc<RoomState>("get_room_state", { p_room: room }),
  myRooms: () => rpc<MyRoom[]>("get_my_rooms"),
  startGame: (room: string) => rpc<{ game_id: string }>("start_game", { p_room: room }),
  returnToLobby: (room: string) => rpc<void>("return_to_lobby", { p_room: room }),
  leaderboard: (room: string | null) => rpc<LeaderboardRow[]>("get_leaderboard", { p_room: room }),
  usageStats: () => rpc<Record<string, unknown>>("get_usage_stats"),
  adminCleanup: () => rpc<Record<string, number>>("admin_cleanup"),
  // v0.4.0
  myRole: () => rpc<Role>("get_my_role"),
  myNotices: () =>
    rpc<{ id: string; kind: "warning" | "suspension"; reason: string; starts_at: number; ends_at: number | null; revoked: boolean }[]>("get_my_notices"),
  appSettings: () => rpc<AppSettings>("get_app_settings"),
  latestRelease: (platform: "android" | "ios") => rpc<Release | null>("get_latest_release", { p_platform: platform }),
  logError: (code: string, context: string, version: string) => rpc<void>("log_client_error", { p_code: code, p_context: context, p_app_version: version }),
  reportPlayer: (target: string | null, category: string, message: string, game?: string | null, room?: string | null) =>
    rpc<{ id: string }>("report_player", { p_target: target, p_category: category, p_message: message, p_game: game ?? null, p_room: room ?? null }),
  achievements: () => rpc<Achievement[]>("get_my_achievements"),
  myStats: () => rpc<{ streak: number; best_streak: number; objectives: number; by_mode: Record<string, ModeStats> }>("get_my_stats"),
  replay: (game: string) => rpc<ReplayData>("get_replay", { p_game: game }),
  spectator: (game: string) => rpc<SpectatorView>("get_spectator_view", { p_game: game }),
};

/** Configurations sauvegardées (table protégée par RLS : propriétaire seulement). */
export const savedConfigs = {
  async list(): Promise<SavedConfig[]> {
    const sb = getSupabase();
    if (!sb) throw new AppError("E_NOT_CONFIGURED");
    const { data, error } = await sb.from("saved_game_configs").select("id,name,config,updated_at").order("updated_at", { ascending: false });
    if (error) throw toAppError(error);
    return (data ?? []).map((r) => ({ ...r, config: normalizeConfig(r.config) })) as SavedConfig[];
  },
  async save(name: string, config: GameConfig, id?: string): Promise<void> {
    const sb = getSupabase();
    if (!sb) throw new AppError("E_NOT_CONFIGURED");
    const row = { name: name.trim().slice(0, 40), config: normalizeConfig(config) };
    const { error } = id ? await sb.from("saved_game_configs").update(row).eq("id", id) : await sb.from("saved_game_configs").insert(row);
    if (error) throw toAppError(error);
  },
  async remove(id: string): Promise<void> {
    const sb = getSupabase();
    if (!sb) throw new AppError("E_NOT_CONFIGURED");
    const { error } = await sb.from("saved_game_configs").delete().eq("id", id);
    if (error) throw toAppError(error);
  },
};

/** Administration : chaque appel est revérifié côté serveur (rôle requis). */
export const adminApi = {
  overview: () => rpc<AdminJson>("admin_overview"),
  searchPlayers: (q: string) =>
    rpc<{ id: string; username: string; role: Role; is_guest: boolean; games_played: number; wins: number; created_at: number; suspended_until: number | null }[]>(
      "admin_search_players",
      { p_query: q },
    ),
  playerDetail: (u: string) => rpc<AdminJson>("admin_player_detail", { p_user: u }),
  warn: (u: string, reason: string) => rpc("admin_warn", { p_user: u, p_reason: reason }),
  suspend: (u: string, hours: number, reason: string) => rpc("admin_suspend", { p_user: u, p_hours: hours, p_reason: reason }),
  revokeSanction: (id: string, reason: string) => rpc("admin_revoke_sanction", { p_sanction: id, p_reason: reason }),
  setRole: (u: string, role: Role, reason: string) => rpc("admin_set_role", { p_user: u, p_role: role, p_reason: reason }),
  reports: (status: string | null) => rpc<AdminJson[]>("admin_reports", { p_status: status }),
  reportNote: (id: string, note: string) => rpc("admin_report_note", { p_report: id, p_note: note }),
  reportStatus: (id: string, status: string, resolution: string) => rpc("admin_report_status", { p_report: id, p_status: status, p_resolution: resolution }),
  games: () => rpc<{ games: AdminJson[]; rooms: AdminJson[] }>("admin_games"),
  gameDetail: (g: string) => rpc<AdminJson>("admin_game_detail", { p_game: g }),
  pauseGame: (g: string, reason: string) => rpc("admin_pause_game", { p_game: g, p_reason: reason }),
  resumeGame: (g: string, reason: string) => rpc("admin_resume_game", { p_game: g, p_reason: reason }),
  endGame: (g: string, reason: string) => rpc("admin_end_game", { p_game: g, p_reason: reason }),
  closeRoom: (r: string, reason: string) => rpc("admin_close_room", { p_room: r, p_reason: reason }),
  setSetting: (key: string, value: unknown, reason: string) => rpc("admin_set_setting", { p_key: key, p_value: value, p_reason: reason }),
  publishRelease: (platform: string, version: string, severity: string, url: string | null, notes: string, minBuild: number | null) =>
    rpc<{ id: string; build: number }>("admin_publish_release", {
      p_platform: platform, p_version: version, p_severity: severity, p_url: url, p_notes: notes, p_min_supported_build: minBuild,
    }),
  audit: (limit = 100) => rpc<AdminJson[]>("admin_audit_log", { p_limit: limit }),
};

/** Implémentation de l'API attendue par le contrôleur de partie partagé. */
export const gameApi: GameApi = {
  gameView: (g) => rpc<GameView>("get_game_view", { p_game: g }),
  serverTime: () => rpc<number>("server_time"),
  tick: (g) => rpc("game_tick", { p_game: g }),
  heartbeat: (g, h?: HealthReport) =>
    rpc("heartbeat", { p_game: g, p_app_state: h?.app_state ?? null, p_gps_state: h?.gps_state ?? null, p_battery: h?.battery ?? null }),
  reportPosition: (g, fix: DeviceFix) =>
    rpc("report_position", {
      p_game: g,
      p_lat: fix.lat,
      p_lng: fix.lng,
      p_accuracy: Math.round(fix.accuracy * 10) / 10,
      p_recorded_at: Math.round(fix.timestamp),
      p_speed: fix.speed ?? null,
      p_heading: fix.heading ?? null,
    }),
  capture: (g) => rpc("attempt_capture", { p_game: g }),
  radar: (g) => rpc("radar_activate", { p_game: g }),
  ability: (g, key: AbilityKey) => rpc("use_ability", { p_game: g, p_key: key, p_target: null }),
  pause: (g) => rpc("pause_game", { p_game: g }),
  resume: (g) => rpc("resume_game", { p_game: g }),
  abort: (g) => rpc("abort_game", { p_game: g }),
  leaveGame: (g) => rpc("leave_game", { p_game: g }),
  safetyStop: (g) => rpc("safety_stop", { p_game: g }),
  teamMessage: (g, code) => rpc("team_message", { p_game: g, p_code: code }),
  placeMarker: (g, kind: MarkerKind, lat, lng) => rpc("place_marker", { p_game: g, p_kind: kind, p_lat: lat, p_lng: lng, p_ttl_s: 180 }),
  removeMarker: (g, marker) => rpc("remove_marker", { p_game: g, p_marker: marker }),
  sos: (g, message, share) => rpc("sos_raise", { p_game: g, p_message: message, p_share_location: share }),
  sosResolve: (g, note) => rpc("sos_resolve", { p_game: g, p_note: note }),
  captureToken: (g) => rpc<CaptureToken>("get_capture_token", { p_game: g }),
  captureByToken: (g, code) => rpc("capture_by_token", { p_game: g, p_code: code }),
};
