import { beforeEach, describe, expect, it } from "vitest";
import { TestDb, expectRpcError, type TestUser } from "./harness";

let db: TestDb;
let alice: TestUser, bob: TestUser, carol: TestUser;

beforeEach(async () => {
  db = await TestDb.create();
  alice = await db.createUser("Alice");
  bob = await db.createUser("Bob");
  carol = await db.createUser("Carol");
});

async function createRoom(user: TestUser, extra: Record<string, unknown> = {}) {
  return db.as(user).rpc<{ room_id: string; code: string }>("create_room", { p_name: "Soirée", ...extra });
}

describe("profils", () => {
  it("crée automatiquement un profil invité à l'inscription", async () => {
    const rows = await db.sql<{ is_guest: boolean; username: string }>(`select * from public.profiles where id = $1`, [
      alice.id,
    ]);
    expect(rows[0].is_guest).toBe(true);
    expect(rows[0].username).toBe("Alice");
  });

  it("refuse un pseudo invalide ou déjà pris (insensible à la casse)", async () => {
    await expectRpcError(db.as(alice).rpc("update_my_profile", { p_username: "a" }), "E_INVALID_USERNAME");
    await expectRpcError(db.as(alice).rpc("update_my_profile", { p_username: "<script>" }), "E_INVALID_USERNAME");
    await expectRpcError(db.as(alice).rpc("update_my_profile", { p_username: "bob" }), "E_USERNAME_TAKEN");
  });

  it("interdit la modification directe des statistiques", async () => {
    await expect(db.as(alice).query(`update public.profiles set wins = 999 where id = '${alice.id}'`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("exige un profil complété pour créer un salon", async () => {
    await db.sql(`insert into auth.users (id, is_anonymous) values ('00000000-0000-0000-0000-0000000000aa', true)`);
    await expectRpcError(
      db.as({ id: "00000000-0000-0000-0000-0000000000aa", name: "x" }).rpc("create_room", { p_name: "X" }),
      "E_PROFILE_INCOMPLETE",
    );
  });
});

describe("salons", () => {
  it("crée un salon avec un code valide et l'hôte comme membre", async () => {
    const r = await createRoom(alice);
    expect(r.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const state = await db.as(alice).rpc<{ room: { host_id: string }; members: unknown[] }>("get_room_state", {
      p_room: r.room_id,
    });
    expect(state.room.host_id).toBe(alice.id);
    expect(state.members).toHaveLength(1);
  });

  it("normalise la configuration (bornes et valeurs par défaut)", async () => {
    const r = await createRoom(alice, { p_config: { duration_s: 99999, prep_s: -5, radar: { precision: "nope" } } });
    const state = await db.as(alice).rpc<{ room: { config: Record<string, any> } }>("get_room_state", {
      p_room: r.room_id,
    });
    expect(state.room.config.duration_s).toBe(3600);
    expect(state.room.config.prep_s).toBe(0);
    expect(state.room.config.radar.precision).toBe("sector");
    expect(Object.keys(state.room.config.abilities).sort()).toEqual(
      ["barrier", "ghost", "jammer", "scan", "sprint", "tracker"].sort(),
    );
  });

  it("valide les codes d'invitation", async () => {
    await expectRpcError(db.as(bob).rpc("join_room", { p_code: "abc" }), "E_INVALID_CODE");
    await expectRpcError(db.as(bob).rpc("join_room", { p_code: "O0I1AB" }), "E_INVALID_CODE");
    await expectRpcError(db.as(bob).rpc("join_room", { p_code: "ZZZZZZ" }), "E_ROOM_NOT_FOUND");
  });

  it("rejoindre est idempotent (reconnexion) et insensible à la casse", async () => {
    const r = await createRoom(alice);
    const j1 = await db.as(bob).rpc<{ rejoined: boolean }>("join_room", { p_code: r.code.toLowerCase() });
    const j2 = await db.as(bob).rpc<{ rejoined: boolean }>("join_room", { p_code: r.code });
    expect(j1.rejoined).toBe(false);
    expect(j2.rejoined).toBe(true);
    const members = await db.sql(`select * from public.room_members where room_id = $1`, [r.room_id]);
    expect(members).toHaveLength(2);
  });

  it("refuse l'entrée dans un salon plein", async () => {
    const r = await createRoom(alice, { p_max_players: 2 });
    await db.as(bob).rpc("join_room", { p_code: r.code });
    await expectRpcError(db.as(carol).rpc("join_room", { p_code: r.code }), "E_ROOM_FULL");
  });

  it("isole les salons : un non-membre ne voit rien", async () => {
    const r = await createRoom(alice);
    await expectRpcError(db.as(bob).rpc("get_room_state", { p_room: r.room_id }), "E_NOT_MEMBER");
    expect(await db.as(bob).query(`select * from public.rooms`)).toHaveLength(0);
    expect(await db.as(bob).query(`select * from public.room_members`)).toHaveLength(0);
  });

  it("réserve les actions d'hôte à l'hôte", async () => {
    const r = await createRoom(alice);
    await db.as(bob).rpc("join_room", { p_code: r.code });
    await expectRpcError(
      db.as(bob).rpc("set_member_team", { p_room: r.room_id, p_user: bob.id, p_team: "hunter" }),
      "E_NOT_HOST",
    );
    await expectRpcError(db.as(bob).rpc("start_game", { p_room: r.room_id }), "E_NOT_HOST");
    await expectRpcError(db.as(bob).rpc("kick_member", { p_room: r.room_id, p_user: alice.id }), "E_NOT_HOST");
    await expectRpcError(db.as(bob).rpc("update_room_settings", { p_room: r.room_id, p_name: "Hack" }), "E_NOT_HOST");
  });

  it("respecte l'autorisation de choix d'équipe", async () => {
    const r = await createRoom(alice, { p_allow_team_choice: false });
    await db.as(bob).rpc("join_room", { p_code: r.code });
    await expectRpcError(db.as(bob).rpc("choose_team", { p_room: r.room_id, p_team: "hunter" }), "E_TEAM_CHOICE_DISABLED");
    await db.as(alice).rpc("update_room_settings", { p_room: r.room_id, p_allow_team_choice: true });
    await db.as(bob).rpc("choose_team", { p_room: r.room_id, p_team: "hunter" });
    await expectRpcError(db.as(bob).rpc("choose_team", { p_room: r.room_id, p_team: "admin" }), "E_INVALID_TEAM");
  });

  it("répartit automatiquement les équipes selon le ratio", async () => {
    const r = await createRoom(alice, { p_config: { hunter_ratio: 0.3 } });
    const others: TestUser[] = [];
    for (let i = 0; i < 9; i++) others.push(await db.createUser(`P${i}`));
    for (const u of others) await db.as(u).rpc("join_room", { p_code: r.code });
    await db.as(alice).rpc("auto_assign_teams", { p_room: r.room_id });
    const teams = await db.sql<{ team: string; n: number }>(
      `select team, count(*)::int n from public.room_members where room_id = $1 group by team`,
      [r.room_id],
    );
    const map = Object.fromEntries(teams.map((t) => [t.team, t.n]));
    expect(map.hunter).toBe(3);
    expect(map.fugitive).toBe(7);
  });

  it("exclut et bannit un joueur", async () => {
    const r = await createRoom(alice);
    await db.as(bob).rpc("join_room", { p_code: r.code });
    await expectRpcError(db.as(alice).rpc("kick_member", { p_room: r.room_id, p_user: alice.id }), "E_CANNOT_KICK_SELF");
    await db.as(alice).rpc("kick_member", { p_room: r.room_id, p_user: bob.id, p_ban: true });
    await expectRpcError(db.as(bob).rpc("join_room", { p_code: r.code }), "E_BANNED");
    const msgs = await db.broadcasts(`room:${r.room_id}`);
    expect(msgs.map((m) => m.payload.t)).toContain("member_kicked");
  });

  it("transfère l'hôte au membre le plus ancien quand l'hôte part, puis ferme le salon vide", async () => {
    const r = await createRoom(alice);
    await db.as(bob).rpc("join_room", { p_code: r.code });
    await db.advance(1000);
    await db.as(carol).rpc("join_room", { p_code: r.code });
    await db.as(alice).rpc("leave_room", { p_room: r.room_id });
    let room = (await db.sql<{ host_id: string; status: string }>(`select * from public.rooms where id = $1`, [r.room_id]))[0];
    expect(room.host_id).toBe(bob.id);
    await db.as(bob).rpc("leave_room", { p_room: r.room_id });
    room = (await db.sql<{ host_id: string; status: string }>(`select * from public.rooms where id = $1`, [r.room_id]))[0];
    expect(room.host_id).toBe(carol.id);
    await db.as(carol).rpc("leave_room", { p_room: r.room_id });
    room = (await db.sql<{ host_id: string; status: string }>(`select * from public.rooms where id = $1`, [r.room_id]))[0];
    expect(room.status).toBe("closed");
  });

  it("transfère l'hôte inactif depuis 3 minutes au prochain heartbeat d'un membre", async () => {
    const r = await createRoom(alice);
    await db.as(bob).rpc("join_room", { p_code: r.code });
    await db.advance(4 * 60 * 1000);
    await db.as(bob).rpc("room_heartbeat", { p_room: r.room_id });
    const room = (await db.sql<{ host_id: string }>(`select host_id from public.rooms where id = $1`, [r.room_id]))[0];
    expect(room.host_id).toBe(bob.id);
  });

  it("valide les conditions de démarrage", async () => {
    const r = await createRoom(alice);
    await expectRpcError(db.as(alice).rpc("start_game", { p_room: r.room_id }), "E_NOT_ENOUGH_PLAYERS");
    await db.as(bob).rpc("join_room", { p_code: r.code });
    await expectRpcError(db.as(alice).rpc("start_game", { p_room: r.room_id }), "E_TEAMS_INCOMPLETE");
    await db.as(alice).rpc("set_member_team", { p_room: r.room_id, p_user: alice.id, p_team: "hunter" });
    await db.as(alice).rpc("set_member_team", { p_room: r.room_id, p_user: bob.id, p_team: "hunter" });
    await expectRpcError(db.as(alice).rpc("start_game", { p_room: r.room_id }), "E_TEAMS_UNBALANCED");
    await db.as(alice).rpc("set_member_team", { p_room: r.room_id, p_user: bob.id, p_team: "fugitive" });
    const g = await db.as(alice).rpc<{ game_id: string }>("start_game", { p_room: r.room_id });
    expect(g.game_id).toBeTruthy();
    await expectRpcError(db.as(carol).rpc("join_room", { p_code: r.code }), "E_GAME_IN_PROGRESS");
    await expectRpcError(db.as(alice).rpc("start_game", { p_room: r.room_id }), "E_NOT_IN_LOBBY");
  });

  it("limite la fréquence des tentatives de connexion à un salon", async () => {
    for (let i = 0; i < 10; i++) {
      await expectRpcError(db.as(bob).rpc("join_room", { p_code: "ZZZZZZ" }), "E_ROOM_NOT_FOUND");
    }
    await expectRpcError(db.as(bob).rpc("join_room", { p_code: "ZZZZZZ" }), "E_RATE_LIMITED");
    await db.advance(61_000);
    await expectRpcError(db.as(bob).rpc("join_room", { p_code: "ZZZZZZ" }), "E_ROOM_NOT_FOUND");
  });

  it("gère les configurations sauvegardées (propriétaire uniquement)", async () => {
    await db.as(alice).query(`insert into public.saved_game_configs (name, config) values ('Rapide', '{"duration_s":300}')`);
    expect(await db.as(alice).query(`select * from public.saved_game_configs`)).toHaveLength(1);
    expect(await db.as(bob).query(`select * from public.saved_game_configs`)).toHaveLength(0);
    await expect(
      db.as(bob).query(`insert into public.saved_game_configs (owner_id, name, config) values ('${alice.id}', 'X', '{}')`),
    ).rejects.toThrow(/row-level security/);
  });
});
