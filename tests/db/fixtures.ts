import { TestDb, type TestUser } from "./harness";

export interface GameFixture {
  db: TestDb;
  host: TestUser;
  hunters: TestUser[];
  fugitives: TestUser[];
  roomId: string;
  code: string;
  gameId: string;
}

/** Crée un salon avec des équipes assignées et démarre une partie. */
export async function setupGame(
  opts: { hunters?: number; fugitives?: number; config?: Record<string, unknown>; db?: TestDb; openMap?: boolean } = {},
): Promise<GameFixture> {
  const db = opts.db ?? (await TestDb.create());
  const nh = opts.hunters ?? 1;
  const nf = opts.fugitives ?? 2;
  const hunters: TestUser[] = [];
  const fugitives: TestUser[] = [];
  const stamp = Math.random().toString(36).slice(2, 6);
  for (let i = 0; i < nh; i++) hunters.push(await db.createUser(`H${i}_${stamp}`));
  for (let i = 0; i < nf; i++) fugitives.push(await db.createUser(`F${i}_${stamp}`));
  const host = hunters[0];
  const { room_id, code } = await db
    .as(host)
    .rpc<{ room_id: string; code: string }>("create_room", { p_name: "Salon test", p_config: opts.config ?? {} });
  for (const u of [...hunters.slice(1), ...fugitives]) await db.as(u).rpc("join_room", { p_code: code });
  for (const u of hunters) await db.as(host).rpc("set_member_team", { p_room: room_id, p_user: u.id, p_team: "hunter" });
  for (const u of fugitives)
    await db.as(host).rpc("set_member_team", { p_room: room_id, p_user: u.id, p_team: "fugitive" });
  const { game_id } = await db.as(host).rpc<{ game_id: string }>("start_game", { p_room: room_id });
  if (opts.openMap !== false) await setOpenMap(db, game_id);
  return { db, host, hunters, fugitives, roomId: room_id, code, gameId: game_id };
}

/** Remplace la carte par une grille entièrement libre (tests déterministes). */
export async function setOpenMap(db: TestDb, gameId: string, size = 22) {
  const rows = Array.from({ length: size }, () => ".".repeat(size));
  await db.sql(`update public.games set map = $2::jsonb where id = $1`, [
    gameId,
    JSON.stringify({ w: size, h: size, rows }),
  ]);
}

export async function place(db: TestDb, gameId: string, user: TestUser, x: number, y: number) {
  await db.sql(`update public.player_states set x = $3, y = $4 where game_id = $1 and user_id = $2`, [
    gameId,
    user.id,
    x,
    y,
  ]);
  await db.sql(`select private.refresh_vis($1)`, [gameId]);
}

/** Avance au-delà de la préparation et déclenche la transition. */
export async function skipPreparation(f: GameFixture) {
  const g = await f.db.sql<{ phase_ends_at: Date }>(`select phase_ends_at from public.games where id = $1`, [f.gameId]);
  await f.db.setNow(new Date(new Date(g[0].phase_ends_at).getTime() + 10));
  await keepAlive(f.db, f.gameId);
  await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
}

export async function gamePhase(db: TestDb, gameId: string): Promise<string> {
  return (await db.sql<{ phase: string }>(`select phase from public.games where id = $1`, [gameId]))[0].phase;
}

export async function playerRow(db: TestDb, gameId: string, user: TestUser) {
  return (
    await db.sql<Record<string, unknown>>(`select * from public.player_states where game_id = $1 and user_id = $2`, [
      gameId,
      user.id,
    ])
  )[0];
}

/** Garde tous les joueurs « vivants » (heartbeat simulé) pour éviter les abandons. */
export async function keepAlive(db: TestDb, gameId: string) {
  await db.sql(`update public.player_states set last_seen_at = private.now_(), connected = true where game_id = $1`, [
    gameId,
  ]);
}
