/**
 * Accès typé aux RPC serveur. Toute action de jeu passe par ici :
 * le client ne modifie jamais directement l'état.
 */
import { AppError, toAppError } from "./errors";
import { metrics } from "./metrics";
import { getSupabase } from "./supabase";
import type { GameView } from "./game/state";
import type { AbilityKey, GameConfig, RadarPulse, Team } from "./engine/types";

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new AppError("E_NOT_CONFIGURED");
  const t0 = performance.now();
  let data: unknown, error: unknown;
  try {
    ({ data, error } = await sb.rpc(fn, args));
  } catch (e) {
    metrics.rpc(false, performance.now() - t0);
    throw toAppError(e);
  }
  metrics.rpc(!error, performance.now() - t0);
  if (error) throw toAppError(error);
  const maybe = data as { error?: unknown } | null;
  if (maybe && typeof maybe === "object" && typeof maybe.error === "string") throw new AppError(maybe.error);
  return data as T;
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
  created_at: string;
}

export interface RoomMember {
  user_id: string;
  username: string;
  avatar: string;
  team: Team | null;
  is_ready: boolean;
  joined_at: string;
  last_seen_at: string;
  is_host: boolean;
  is_guest: boolean;
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
    created_at: string;
  };
  members: RoomMember[];
  game: { id: string; phase: string; winner: string | null; end_reason: string | null; participant: boolean } | null;
}

export interface MyRoom {
  id: string;
  code: string;
  name: string;
  status: string;
  is_host: boolean;
  current_game_id: string | null;
  members: number;
  last_activity_at: string;
}

export interface LeaderboardRow {
  id: string;
  username: string;
  avatar: string;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  captures: number;
  survival_seconds: number;
  total_score: number;
  win_rate: number;
}

export const api = {
  updateProfile: (username: string, avatar: string) =>
    rpc<Profile>("update_my_profile", { p_username: username, p_avatar: avatar }),
  createRoom: (name: string, config: Partial<GameConfig>, maxPlayers: number, allowTeamChoice: boolean) =>
    rpc<{ room_id: string; code: string }>("create_room", {
      p_name: name,
      p_config: config,
      p_max_players: maxPlayers,
      p_allow_team_choice: allowTeamChoice,
    }),
  joinRoom: (code: string) => rpc<{ room_id: string; code: string; rejoined: boolean }>("join_room", { p_code: code }),
  leaveRoom: (room: string) => rpc<void>("leave_room", { p_room: room }),
  kick: (room: string, user: string, ban: boolean) => rpc<void>("kick_member", { p_room: room, p_user: user, p_ban: ban }),
  setMemberTeam: (room: string, user: string, team: Team | null) =>
    rpc<void>("set_member_team", { p_room: room, p_user: user, p_team: team }),
  chooseTeam: (room: string, team: Team | null) => rpc<void>("choose_team", { p_room: room, p_team: team }),
  autoAssign: (room: string) => rpc<void>("auto_assign_teams", { p_room: room }),
  updateRoomSettings: (
    room: string,
    s: { name?: string; config?: Partial<GameConfig>; maxPlayers?: number; allowTeamChoice?: boolean },
  ) =>
    rpc<GameConfig>("update_room_settings", {
      p_room: room,
      p_name: s.name ?? null,
      p_config: s.config ?? null,
      p_max_players: s.maxPlayers ?? null,
      p_allow_team_choice: s.allowTeamChoice ?? null,
    }),
  transferHost: (room: string, user: string) => rpc<void>("transfer_host", { p_room: room, p_user: user }),
  setReady: (room: string, ready: boolean) => rpc<void>("set_ready", { p_room: room, p_ready: ready }),
  roomHeartbeat: (room: string) => rpc<{ server_now: number }>("room_heartbeat", { p_room: room }),
  roomState: (room: string) => rpc<RoomState>("get_room_state", { p_room: room }),
  myRooms: () => rpc<MyRoom[]>("get_my_rooms"),
  startGame: (room: string) => rpc<{ game_id: string }>("start_game", { p_room: room }),
  returnToLobby: (room: string) => rpc<void>("return_to_lobby", { p_room: room }),

  serverTime: () => rpc<number>("server_time"),
  gameView: (game: string) => rpc<GameView>("get_game_view", { p_game: game }),
  tick: (game: string) => rpc<Record<string, number | string | null>>("game_tick", { p_game: game }),
  heartbeat: (game: string) => rpc<{ server_now: number }>("heartbeat", { p_game: game }),
  move: (game: string, path: [number, number][]) =>
    rpc<{ x: number; y: number; steps: number; steps_at: number; server_now: number }>("move", {
      p_game: game,
      p_path: path,
    }),
  capture: (game: string) =>
    rpc<{ captured: string[]; cooldown_until: number; server_now: number }>("attempt_capture", { p_game: game }),
  radar: (game: string) => rpc<RadarPulse & { uses: number }>("radar_activate", { p_game: game }),
  ability: (game: string, key: AbilityKey, target: { x: number; y: number } | null) =>
    rpc<{
      key: AbilityKey;
      used_at: number;
      until: number | null;
      cooldown_until: number;
      uses: number;
      result: Record<string, unknown>;
    }>("use_ability", { p_game: game, p_key: key, p_target: target }),
  pause: (game: string) => rpc<void>("pause_game", { p_game: game }),
  resume: (game: string) => rpc<void>("resume_game", { p_game: game }),
  abort: (game: string) => rpc<void>("abort_game", { p_game: game }),
  leaveGame: (game: string) => rpc<void>("leave_game", { p_game: game }),

  leaderboard: (room: string | null) => rpc<LeaderboardRow[]>("get_leaderboard", { p_room: room }),
  usageStats: () => rpc<Record<string, unknown>>("get_usage_stats"),
  adminCleanup: () => rpc<Record<string, number>>("admin_cleanup"),
};
