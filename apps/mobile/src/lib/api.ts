/** Appels serveur typés. Le client ne modifie jamais directement l'état du jeu. */
import { AppError, toAppError, type AbilityKey, type DeviceFix, type GameApi, type GameConfig, type GameView, type Team } from "@traque/shared";
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
  if (res.error) throw toAppError(res.error);
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
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  captures: number;
  times_captured: number;
  survival_seconds: number;
  total_score: number;
}

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
};

/** Implémentation de l'API attendue par le contrôleur de partie partagé. */
export const gameApi: GameApi = {
  gameView: (g) => rpc<GameView>("get_game_view", { p_game: g }),
  serverTime: () => rpc<number>("server_time"),
  tick: (g) => rpc("game_tick", { p_game: g }),
  heartbeat: (g) => rpc("heartbeat", { p_game: g }),
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
};
