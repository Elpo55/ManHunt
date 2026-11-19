/**
 * Non-régression v0.3.0 (migration 0900) : les événements porteurs de
 * position ne fuient pas après la partie et sont effacés comme les positions.
 */
import { describe, expect, it } from "vitest";
import { report, setupGame, skipPreparation } from "./fixtures";

type Row = { stream: string; type: string; payload: Record<string, unknown> };
const POSITIONAL = ["pos", "enemy_pos", "move", "reveal", "radar", "tracker", "sonar", "vis", "map_effect"];

describe("confidentialité des événements de position", () => {
  it("après la partie, un adversaire ne lit pas les positions de l'autre équipe", async () => {
    const f = await setupGame({ hunters: 2, fugitives: 2 });
    await skipPreparation(f);
    const [h1, h2] = f.hunters;
    const [f1] = f.fugitives;
    await report(f.db, f.gameId, h1, 10, 10);
    await report(f.db, f.gameId, h2, 40, 20);
    await report(f.db, f.gameId, f1, 200, 100);
    const all = await f.db.sql<Row>(`select stream, type, payload from public.game_events where game_id = $1`, [f.gameId]);
    expect(all.some((e) => e.stream === "hunter" && e.type === "pos")).toBe(true);

    await f.db.as(f.host).rpc("abort_game", { p_game: f.gameId });

    const seenByFugitive = await f.db.as(f1).query<Row>(`select stream, type, payload from public.game_events where game_id = $1`, [f.gameId]);
    const leaked = seenByFugitive.filter((e) => e.stream === "hunter" && POSITIONAL.includes(e.type));
    expect(leaked).toHaveLength(0);
    // Les événements sans position restent consultables (résultats, chronologie).
    expect(seenByFugitive.some((e) => e.type === "game_finished")).toBe(true);

    // Un coéquipier garde l'accès aux positions de sa propre équipe (jusqu'à l'effacement).
    const seenByAlly = await f.db.as(h2).query<Row>(`select stream, type from public.game_events where game_id = $1 and type = 'pos'`, [f.gameId]);
    expect(seenByAlly.length).toBeGreaterThan(0);
  });

  it("efface les événements de position 24 h après la partie, garde les autres", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2 });
    await skipPreparation(f);
    await report(f.db, f.gameId, f.hunters[0], 0, 0);
    await report(f.db, f.gameId, f.fugitives[0], 100, 0);
    await f.db.as(f.host).rpc("abort_game", { p_game: f.gameId });
    const count = async () =>
      (await f.db.sql<{ n: number }>(
        `select count(*)::int as n from public.game_events where game_id = $1 and private.is_positional_event(type)`,
        [f.gameId],
      ))[0].n;
    expect(await count()).toBeGreaterThan(0);
    await f.db.advance(23 * 3600_000);
    await f.db.sql(`select private.cleanup()`);
    expect(await count()).toBeGreaterThan(0);
    await f.db.advance(2 * 3600_000);
    const r = await f.db.sql<{ cleanup: Record<string, number> }>(`select private.cleanup()`);
    expect(r[0].cleanup.position_events_deleted).toBeGreaterThan(0);
    expect(await count()).toBe(0);
    const rest = await f.db.sql(`select 1 from public.game_events where game_id = $1 and type = 'game_finished'`, [f.gameId]);
    expect(rest).toHaveLength(1);
  });

  it("l'arrêt de sécurité efface aussi les événements de position du joueur", async () => {
    const f = await setupGame({ hunters: 2, fugitives: 1 });
    await skipPreparation(f);
    const [h1] = f.hunters;
    await report(f.db, f.gameId, h1, 10, 10);
    const mine = async () =>
      (await f.db.sql(`select 1 from public.game_events where game_id = $1 and type in ('pos','enemy_pos','move') and payload->>'u' = $2`, [f.gameId, h1.id])).length;
    expect(await mine()).toBeGreaterThan(0);
    await f.db.as(h1).rpc("safety_stop", { p_game: f.gameId });
    expect(await mine()).toBe(0);
  });
});
