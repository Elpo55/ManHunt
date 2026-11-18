import { TestDb, type TestUser } from "./harness";

/** Zone de test : Paris, Champ-de-Mars, rayon 500 m. */
export const ZONE = { lat: 48.8556, lng: 2.2986, radius_m: 500, label: "Champ-de-Mars", set: true };
const M_LAT = 111_320;

/** Point à `east` m à l'Est et `south` m au Sud du centre de la zone. */
export function at(east: number, south: number): { lat: number; lng: number } {
  return {
    lat: ZONE.lat - south / M_LAT,
    lng: ZONE.lng + east / (M_LAT * Math.cos((ZONE.lat * Math.PI) / 180)),
  };
}

export interface GameFixture {
  db: TestDb;
  host: TestUser;
  hunters: TestUser[];
  fugitives: TestUser[];
  roomId: string;
  code: string;
  gameId: string;
}

/** Salon + équipes + consentements, puis lancement d'une partie GPS. */
export async function setupGame(
  opts: { hunters?: number; fugitives?: number; config?: Record<string, unknown>; db?: TestDb; consent?: boolean } = {},
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
  const { room_id, code } = await db.as(host).rpc<{ room_id: string; code: string }>("create_room", {
    p_name: "Salon test",
    p_config: { zone: ZONE, ...(opts.config ?? {}) },
  });
  for (const u of [...hunters.slice(1), ...fugitives]) await db.as(u).rpc("join_room", { p_code: code });
  for (const u of hunters) await db.as(host).rpc("set_member_team", { p_room: room_id, p_user: u.id, p_team: "hunter" });
  for (const u of fugitives) await db.as(host).rpc("set_member_team", { p_room: room_id, p_user: u.id, p_team: "fugitive" });
  if (opts.consent !== false) {
    for (const u of [...hunters, ...fugitives]) await db.as(u).rpc("set_location_consent", { p_room: room_id, p_consent: true });
  }
  const { game_id } = await db.as(host).rpc<{ game_id: string }>("start_game", { p_room: room_id });
  return { db, host, hunters, fugitives, roomId: room_id, code, gameId: game_id };
}

/**
 * Place directement un joueur (superutilisateur) : utile pour préparer une
 * situation sans passer par le contrôle de vitesse.
 */
export async function place(db: TestDb, gameId: string, user: TestUser, east: number, south: number, accuracy = 8) {
  const p = at(east, south);
  await db.sql(
    `insert into private.player_positions (game_id, user_id, lat, lng, accuracy_m, recorded_at, received_at)
     values ($1, $2, $3, $4, $5, private.now_(), private.now_())
     on conflict (game_id, user_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
       recorded_at = excluded.recorded_at, received_at = excluded.received_at`,
    [gameId, user.id, p.lat, p.lng, accuracy],
  );
  await db.sql(`update public.player_states set last_pos_at = private.now_(), last_seen_at = private.now_(), connected = true where game_id = $1 and user_id = $2`, [
    gameId,
    user.id,
  ]);
}

/** Envoi de position par l'API, comme l'application mobile. */
export async function report(db: TestDb, gameId: string, user: TestUser, east: number, south: number, accuracy = 8) {
  const p = at(east, south);
  return db.as(user).rpc<Record<string, unknown>>("report_position", {
    p_game: gameId,
    p_lat: p.lat,
    p_lng: p.lng,
    p_accuracy: accuracy,
    p_recorded_at: db.now().getTime(),
  });
}

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
    await db.sql<Record<string, unknown>>(`select * from public.player_states where game_id = $1 and user_id = $2`, [gameId, user.id])
  )[0];
}

/** Rafraîchit présence + fraîcheur des positions (simule des envois réguliers). */
export async function keepAlive(db: TestDb, gameId: string) {
  await db.sql(`update public.player_states set last_seen_at = private.now_(), connected = true where game_id = $1`, [gameId]);
  await db.sql(`update private.player_positions set received_at = private.now_(), recorded_at = private.now_() where game_id = $1`, [gameId]);
}
