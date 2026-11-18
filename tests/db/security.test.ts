import { beforeAll, describe, expect, it } from "vitest";
import { expectRpcError } from "./harness";
import { type GameFixture, place, report, setupGame, skipPreparation } from "./fixtures";

type Json = Record<string, any>;
let f: GameFixture;

beforeAll(async () => {
  f = await setupGame({ hunters: 2, fugitives: 2 });
  await skipPreparation(f);
  await place(f.db, f.gameId, f.hunters[0], -200, 0);
  await place(f.db, f.gameId, f.hunters[1], -180, 0);
  await place(f.db, f.gameId, f.fugitives[0], 200, 150);
  await place(f.db, f.gameId, f.fugitives[1], 210, 150);
});

describe("RLS : isolation des équipes et des positions", () => {
  it("les positions GPS brutes sont inaccessibles à tous les clients", async () => {
    for (const u of [...f.hunters, ...f.fugitives]) {
      await expect(f.db.as(u).query(`select * from private.player_positions`)).rejects.toThrow(/permission denied/);
      await expect(f.db.as(u).query(`select * from private.position_history`)).rejects.toThrow(/permission denied/);
    }
  });

  it("un joueur ne lit que les états de son équipe", async () => {
    const h = await f.db.as(f.hunters[0]).query<Json>(`select user_id from public.player_states where game_id = $1`, [f.gameId]);
    expect(h.map((r) => r.user_id).sort()).toEqual(f.hunters.map((x) => x.id).sort());
    const fu = await f.db.as(f.fugitives[0]).query<Json>(`select user_id from public.player_states where game_id = $1`, [f.gameId]);
    expect(fu.map((r) => r.user_id).sort()).toEqual(f.fugitives.map((x) => x.id).sort());
  });

  it("les colonnes techniques de games sont inaccessibles", async () => {
    await expect(f.db.as(f.fugitives[0]).query(`select vis_hunter from public.games where id = $1`, [f.gameId])).rejects.toThrow(/permission denied/);
    await expect(f.db.as(f.fugitives[0]).query(`select * from public.games`)).rejects.toThrow(/permission denied/);
    expect(await f.db.as(f.fugitives[0]).query(`select id, phase, config from public.games where id = $1`, [f.gameId])).toHaveLength(1);
  });

  it("le journal d'événements est filtré par flux", async () => {
    await f.db.advance(5000);
    await report(f.db, f.gameId, f.fugitives[0], 205, 150);
    const rows = await f.db.as(f.hunters[0]).query<Json>(`select stream from public.game_events where game_id = $1`, [f.gameId]);
    for (const s of new Set(rows.map((r) => r.stream))) expect(["all", "hunter", `p:${f.hunters[0].id}`]).toContain(s);
  });

  it("aucune écriture directe sur les tables de jeu", async () => {
    const u = f.fugitives[0];
    await expect(f.db.as(u).query(`update public.player_states set status = 'active' where user_id = '${u.id}'`)).rejects.toThrow(/permission denied/);
    await expect(f.db.as(u).query(`update public.games set phase = 'finished'`)).rejects.toThrow(/permission denied/);
    await expect(
      f.db.as(u).query(`insert into public.game_events (game_id, stream, sn, type) values ('${f.gameId}', 'all', 999, 'x')`),
    ).rejects.toThrow(/permission denied/);
    await expect(f.db.as(u).query(`update public.room_members set location_consent_at = now()`)).rejects.toThrow(/permission denied/);
  });

  it("un utilisateur ne peut pas appeler les fonctions privées", async () => {
    await expect(f.db.as(f.fugitives[0]).query(`select private.finish_game($1, 'fugitive', 'time_up')`, [f.gameId])).rejects.toThrow(/permission denied/);
    await expect(f.db.as(f.hunters[0]).query(`select private.enemy_payload($1, $2)`, [f.gameId, f.fugitives[0].id])).rejects.toThrow(/permission denied/);
    await expect(f.db.as(f.hunters[0]).query(`select private.fresh_position($1, $2, 60)`, [f.gameId, f.fugitives[0].id])).rejects.toThrow(/permission denied/);
  });

  it("le rôle anonyme (clé publique sans session) ne peut rien exécuter", async () => {
    await f.db.pg.query("reset role");
    await f.db.pg.query("set role anon");
    await expect(f.db.pg.query(`select public.get_game_view($1)`, [f.gameId])).rejects.toThrow(/permission denied/);
    await expect(f.db.pg.query(`select public.report_position($1, 48.0, 2.0, 5, 0)`, [f.gameId])).rejects.toThrow(/permission denied/);
    await f.db.pg.query("reset role");
  });

  it("un non-participant ne peut ni envoyer de position ni agir", async () => {
    const intruder = await f.db.createUser("Intrus2");
    await expectRpcError(
      f.db.as(intruder).rpc("report_position", { p_game: f.gameId, p_lat: 48.85, p_lng: 2.29, p_accuracy: 5, p_recorded_at: f.db.now().getTime() }),
      "E_NOT_PARTICIPANT",
    );
    await expectRpcError(f.db.as(intruder).rpc("attempt_capture", { p_game: f.gameId }), "E_NOT_PARTICIPANT");
    await expectRpcError(f.db.as(intruder).rpc("safety_stop", { p_game: f.gameId }), "E_NOT_PARTICIPANT");
  });
});

describe("Realtime : autorisation des canaux privés", () => {
  it("chaque joueur n'accède qu'aux topics de son audience", async () => {
    const [h] = f.hunters;
    const [fu] = f.fugitives;
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
      return f.db.as(h).query(`insert into realtime.messages (topic, extension, event, payload) values ($1, $2, 'x', '{}')`, [topic, extension]);
    };
    await expect(tryInsert(`game:${f.gameId}:fugitive`, "broadcast")).rejects.toThrow(/row-level security/);
    await expect(tryInsert(`game:${f.gameId}:all`, "broadcast")).rejects.toThrow(/row-level security/);
    await expect(tryInsert(`room:${f.roomId}`, "presence")).resolves.toBeDefined();
  });

  it("aucun flux ne transporte de coordonnées brutes", async () => {
    const msgs = await f.db.sql<Json>(`select topic, payload from realtime.messages where payload ? 'd'`);
    const raw = await f.db.sql<Json>(`select lat, lng from private.player_positions where game_id = $1`, [f.gameId]);
    const text = JSON.stringify(msgs);
    for (const r of raw) expect(text).not.toContain(String(r.lat));
    // Le flux public ne contient jamais de coordonnées.
    for (const m of msgs.filter((x) => x.topic === `game:${f.gameId}:all`)) expect(JSON.stringify(m.payload.d)).not.toContain('"lat"');
  });
});

describe("intégrité des séquences", () => {
  it("les numéros de séquence sont contigus et uniques par flux", async () => {
    const rows = await f.db.sql<{ stream: string; sns: number[] }>(
      `select stream, array_agg(sn order by sn) sns from public.game_events where game_id = $1 group by stream`,
      [f.gameId],
    );
    for (const r of rows) {
      const sns = r.sns.map(Number);
      expect(sns).toEqual(Array.from({ length: sns.length }, (_, i) => i + 1));
    }
  });
});
