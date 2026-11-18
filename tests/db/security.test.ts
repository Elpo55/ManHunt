import { beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectRpcError } from "./harness";
import { type GameFixture, place, setupGame, skipPreparation } from "./fixtures";

type Json = Record<string, any>;
let f: GameFixture;

beforeAll(async () => {
  f = await setupGame({ hunters: 2, fugitives: 2 });
  await skipPreparation(f);
  await place(f.db, f.gameId, f.hunters[0], 1, 1);
  await place(f.db, f.gameId, f.hunters[1], 2, 1);
  await place(f.db, f.gameId, f.fugitives[0], 18, 18);
  await place(f.db, f.gameId, f.fugitives[1], 19, 18);
});

describe("RLS : isolation des équipes", () => {
  it("un Chasseur ne peut pas lire les positions des Fugitifs", async () => {
    const rows = await f.db.as(f.hunters[0]).query<Json>(`select user_id, x, y from public.player_states where game_id = $1`, [f.gameId]);
    expect(rows.map((r) => r.user_id).sort()).toEqual(f.hunters.map((h) => h.id).sort());
  });

  it("un Fugitif ne voit que son équipe", async () => {
    const rows = await f.db.as(f.fugitives[0]).query<Json>(`select user_id from public.player_states where game_id = $1`, [f.gameId]);
    expect(rows.map((r) => r.user_id).sort()).toEqual(f.fugitives.map((h) => h.id).sort());
  });

  it("les colonnes techniques de games (visibilité) sont inaccessibles", async () => {
    await expect(f.db.as(f.fugitives[0]).query(`select vis_hunter from public.games where id = $1`, [f.gameId])).rejects.toThrow(
      /permission denied/,
    );
    await expect(f.db.as(f.fugitives[0]).query(`select * from public.games`)).rejects.toThrow(/permission denied/);
    const ok = await f.db.as(f.fugitives[0]).query(`select id, phase, map from public.games where id = $1`, [f.gameId]);
    expect(ok).toHaveLength(1);
  });

  it("le journal d'événements est filtré par flux", async () => {
    await f.db.as(f.fugitives[0]).rpc("move", { p_game: f.gameId, p_path: [[18, 17]] });
    const hunterView = await f.db.as(f.hunters[0]).query<Json>(`select stream from public.game_events where game_id = $1`, [f.gameId]);
    const streams = new Set(hunterView.map((r) => r.stream));
    expect(streams.has("fugitive")).toBe(false);
    for (const s of streams) expect(["all", "hunter", `p:${f.hunters[0].id}`]).toContain(s);
  });

  it("aucune écriture directe sur les tables de jeu", async () => {
    const u = f.fugitives[0];
    await expect(f.db.as(u).query(`update public.player_states set x = 0 where user_id = '${u.id}'`)).rejects.toThrow(/permission denied/);
    await expect(f.db.as(u).query(`update public.games set phase = 'finished'`)).rejects.toThrow(/permission denied/);
    await expect(
      f.db.as(u).query(`insert into public.game_events (game_id, stream, sn, type) values ('${f.gameId}', 'all', 999, 'x')`),
    ).rejects.toThrow(/permission denied/);
    await expect(f.db.as(u).query(`update public.room_members set team = 'hunter'`)).rejects.toThrow(/permission denied/);
    await expect(f.db.as(u).query(`select * from private.rate_limits`)).rejects.toThrow(/permission denied/);
  });

  it("un utilisateur ne peut pas appeler les fonctions privées", async () => {
    await expect(f.db.as(f.fugitives[0]).query(`select private.finish_game($1, 'fugitive', 'time_up')`, [f.gameId])).rejects.toThrow(
      /permission denied/,
    );
    await expect(f.db.as(f.fugitives[0]).query(`select private.compute_vis($1, 'hunter')`, [f.gameId])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("le rôle anonyme (clé publique sans session) ne peut rien exécuter", async () => {
    await f.db.pg.query("reset role");
    await f.db.pg.query("set role anon");
    await expect(f.db.pg.query(`select public.get_game_view($1)`, [f.gameId])).rejects.toThrow(/permission denied/);
    await expect(f.db.pg.query(`select * from public.profiles`)).rejects.toThrow(/permission denied/);
    await f.db.pg.query("reset role");
  });

  it("un joueur ne peut pas agir dans une partie à laquelle il ne participe pas", async () => {
    const intruder = await f.db.createUser("Intrus2");
    await expectRpcError(f.db.as(intruder).rpc("move", { p_game: f.gameId, p_path: [[1, 1]] }), "E_NOT_PARTICIPANT");
    await expectRpcError(f.db.as(intruder).rpc("attempt_capture", { p_game: f.gameId }), "E_NOT_PARTICIPANT");
    expect(await f.db.as(intruder).query(`select * from public.player_states where game_id = $1`, [f.gameId])).toHaveLength(0);
  });
});

describe("Realtime : autorisation des canaux privés", () => {
  it("chaque joueur n'accède qu'aux topics de son audience", async () => {
    const [h] = f.hunters, [fu] = f.fugitives;
    const g = f.gameId;
    const outsider = await f.db.createUser("Dehors");
    const cases: [string, string, boolean][] = [
      [h.id, `game:${g}:all`, true],
      [h.id, `game:${g}:hunter`, true],
      [h.id, `game:${g}:fugitive`, false],
      [h.id, `game:${g}:p:${h.id}`, true],
      [h.id, `game:${g}:p:${fu.id}`, false],
      [fu.id, `game:${g}:fugitive`, true],
      [fu.id, `game:${g}:hunter`, false],
      [h.id, `room:${f.roomId}`, true],
      [outsider.id, `room:${f.roomId}`, false],
      [outsider.id, `game:${g}:all`, false],
      [h.id, `game:not-a-uuid:all`, false],
      [h.id, `random-topic`, false],
    ];
    for (const [uid, topic, expected] of cases) {
      const ok = await f.db.as({ id: uid, name: "?" }).canRead(topic);
      expect({ topic, ok }).toEqual({ topic, ok: expected });
    }
  });

  it("les clients ne peuvent pas diffuser (seulement publier leur présence)", async () => {
    const [h] = f.hunters;
    const tryInsert = async (topic: string, extension: string) => {
      await f.db.pg.query(`select set_config('realtime.topic', $1, false)`, [topic]);
      return f.db.as(h).query(`insert into realtime.messages (topic, extension, event, payload) values ($1, $2, 'x', '{}')`, [
        topic,
        extension,
      ]);
    };
    await expect(tryInsert(`game:${f.gameId}:hunter`, "broadcast")).rejects.toThrow(/row-level security/);
    await expect(tryInsert(`game:${f.gameId}:all`, "broadcast")).rejects.toThrow(/row-level security/);
    await expect(tryInsert(`room:${f.roomId}`, "presence")).resolves.toBeDefined();
    await expect(tryInsert(`game:${f.gameId}:hunter`, "presence")).rejects.toThrow(/row-level security/);
  });

  it("aucun message des flux Chasseurs/publics ne contient de position de Fugitif non visible", async () => {
    // Les Fugitifs sont loin : rien ne doit fuiter, quelle que soit l'action.
    await f.db.as(f.fugitives[1]).rpc("move", { p_game: f.gameId, p_path: [[19, 17]] });
    await f.db.as(f.fugitives[1]).rpc("use_ability", { p_game: f.gameId, p_key: "ghost" });
    const msgs = [
      ...(await f.db.broadcasts(`game:${f.gameId}:hunter`)),
      ...(await f.db.broadcasts(`game:${f.gameId}:all`)),
    ];
    const text = JSON.stringify(msgs);
    for (const fu of f.fugitives) {
      // L'identifiant peut apparaître (liste des joueurs) mais jamais associé à des coordonnées.
      for (const m of msgs) {
        const d = JSON.stringify(m.payload.d);
        if (d.includes(fu.id)) expect(d).not.toMatch(/"x":\s*1[789]/);
      }
    }
    expect(text).not.toContain('"t":"move","d":{"u":"' + f.fugitives[1].id);
  });
});

describe("post-partie", () => {
  it("révèle toutes les positions et l'historique une fois la partie terminée", async () => {
    const g = await setupGame({ hunters: 1, fugitives: 1, db: f.db });
    await skipPreparation(g);
    await g.db.as(g.fugitives[0]).rpc("move", { p_game: g.gameId, p_path: [[g.db ? 0 : 0, 0]] }).catch(() => undefined);
    await g.db.as(g.host).rpc("abort_game", { p_game: g.gameId });
    const rows = await g.db.as(g.hunters[0]).query(`select user_id from public.player_states where game_id = $1`, [g.gameId]);
    expect(rows).toHaveLength(2);
  });
});

describe("intégrité des séquences", () => {
  it("les numéros de séquence sont contigus et uniques par flux", async () => {
    const db: TestDb = f.db;
    const rows = await db.sql<{ stream: string; sns: number[] }>(
      `select stream, array_agg(sn order by sn) sns from public.game_events where game_id = $1 group by stream`,
      [f.gameId],
    );
    for (const r of rows) {
      const sns = r.sns.map(Number);
      expect(sns).toEqual(Array.from({ length: sns.length }, (_, i) => i + 1));
    }
  });
});
