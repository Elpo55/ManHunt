/**
 * Simulation de charge du moteur GPS : 20 joueurs (6 Chasseurs, 14 Fugitifs)
 * marchent dans une zone réelle de 500 m et envoient leur position toutes
 * les 5 s pendant 6 minutes de jeu ; les Chasseurs poursuivent et tentent
 * des captures.
 *
 * Vérifie la cohérence serveur sous charge (validations, séquences,
 * confidentialité) et estime le volume Realtime. Ne mesure PAS la latence
 * réseau : voir scripts/load-test.mjs pour un test contre un vrai projet.
 */
import { describe, expect, it } from "vitest";
import { at, keepAlive, setupGame, skipPreparation } from "./fixtures";

type Json = Record<string, any>;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("simulation 20 joueurs GPS", () => {
  it("reste cohérente sur 6 minutes de déplacements réels", async () => {
    const f = await setupGame({ hunters: 6, fugitives: 14, config: { duration_s: 1800, prep_s: 60, radar: { interval_s: 60 } } });
    await skipPreparation(f);
    const rnd = mulberry32(42);
    const all = [...f.hunters, ...f.fugitives];
    const pos = new Map(all.map((u, i) => [u.id, { e: Math.cos(i) * 300, s: Math.sin(i) * 300 }]));
    const isHunter = new Set(f.hunters.map((h) => h.id));
    let accepted = 0;
    const errors = new Map<string, number>();
    const timings: number[] = [];
    const count = (code: string) => errors.set(code, (errors.get(code) ?? 0) + 1);

    for (let cycle = 0; cycle < 72; cycle++) {
      await f.db.advance(5000);
      const status = await f.db.sql<Json>(`select user_id, status from public.player_states where game_id = $1`, [f.gameId]);
      const active = new Set(status.filter((s) => s.status === "active").map((s) => s.user_id));
      if ((await f.db.sql<Json>(`select phase from public.games where id = $1`, [f.gameId]))[0].phase === "finished") break;

      for (const u of all) {
        if (!active.has(u.id)) continue;
        const p = pos.get(u.id)!;
        // Marche ~1,5 m/s ; les Chasseurs se dirigent vers le Fugitif actif le plus proche.
        let dx = rnd() * 2 - 1, dy = rnd() * 2 - 1;
        if (isHunter.has(u.id)) {
          const target = f.fugitives.filter((x) => active.has(x.id)).map((x) => pos.get(x.id)!)
            .sort((a, b) => Math.hypot(a.e - p.e, a.s - p.s) - Math.hypot(b.e - p.e, b.s - p.s))[0];
          if (target) { dx = target.e - p.e; dy = target.s - p.s; }
        }
        const n = Math.hypot(dx, dy) || 1;
        p.e = Math.max(-450, Math.min(450, p.e + (dx / n) * 7.5));
        p.s = Math.max(-450, Math.min(450, p.s + (dy / n) * 7.5));
        const t0 = performance.now();
        try {
          const g = at(p.e, p.s);
          await f.db.as(u).rpc("report_position", {
            p_game: f.gameId, p_lat: g.lat, p_lng: g.lng, p_accuracy: 5 + rnd() * 10, p_recorded_at: f.db.now().getTime(),
          });
          accepted++;
          if (isHunter.has(u.id) && cycle % 2 === 0) await f.db.as(u).rpc("attempt_capture", { p_game: f.gameId });
        } catch (e) {
          count((e as { code: string }).code);
        }
        timings.push(performance.now() - t0);
      }
      if (cycle % 6 === 0) await keepAlive(f.db, f.gameId);
    }

    const allowed = new Set(["E_COOLDOWN", "E_RATE_LIMITED", "E_NOT_ACTIVE", "E_GAME_FINISHED", "E_OUT_OF_ZONE"]);
    for (const code of errors.keys()) expect(allowed.has(code), `erreur inattendue ${code}`).toBe(true);

    const seqs = await f.db.sql<{ sns: string[] }>(
      `select array_agg(sn order by sn) sns from public.game_events where game_id = $1 group by stream`, [f.gameId]);
    for (const s of seqs) {
      const sns = s.sns.map(Number);
      expect(sns).toEqual(Array.from({ length: sns.length }, (_, i) => i + 1));
    }
    const [usage] = await f.db.sql<Json>(`select sum(broadcasts)::int b, sum(delivered_estimate)::int d from private.usage_daily`);
    const [stats] = await f.db.sql<Json>(
      `select count(*) filter (where status = 'captured')::int captured, sum(distance)::int dist from public.player_states where game_id = $1`, [f.gameId]);
    const seconds = 72 * 5;
    timings.sort((a, b) => a - b);
    console.log(
      `[simulation GPS] positions acceptées=${accepted} refus=${JSON.stringify(Object.fromEntries(errors))} ` +
        `captures=${stats.captured} distance cumulée=${stats.dist} m broadcasts=${usage.b} ` +
        `livraisons estimées=${usage.d} (~${(usage.d / seconds).toFixed(0)}/s) ` +
        `RPC PGlite p50=${timings[Math.floor(timings.length / 2)].toFixed(1)}ms`,
    );
    expect(accepted).toBeGreaterThan(500);
    expect(stats.captured).toBeGreaterThan(0);
    expect(usage.d / seconds).toBeLessThan(100); // limite gratuite Realtime : 100 messages/s
  }, 600_000);
});
