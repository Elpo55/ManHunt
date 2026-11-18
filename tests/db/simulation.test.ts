/**
 * Simulation de charge côté moteur : 20 joueurs (6 Chasseurs, 14 Fugitifs)
 * jouent des actions aléatoires valides pendant plusieurs minutes de jeu.
 *
 * Ce test vérifie la cohérence du moteur serveur sous charge (invariants,
 * séquences, isolation). Il NE mesure PAS la latence réseau ni Realtime :
 * voir scripts/load-test.mjs pour le test de charge contre un vrai projet.
 */
import { describe, expect, it } from "vitest";
import { keepAlive, setupGame, skipPreparation } from "./fixtures";

type Json = Record<string, any>;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("simulation 20 joueurs", () => {
  it("reste cohérent sur 240 cycles d'actions concurrentes", async () => {
    const f = await setupGame({
      hunters: 6,
      fugitives: 14,
      openMap: false,
      config: { duration_s: 1800, prep_s: 30, radar: { interval_s: 30 }, map_size: "l", step_regen_ms: 1000 },
    });
    await skipPreparation(f);
    const rnd = mulberry32(1234);
    const all = [...f.hunters, ...f.fugitives];
    const [{ map }] = await f.db.sql<{ map: { w: number; h: number; rows: string[] } }>(
      `select map from public.games where id = $1`,
      [f.gameId],
    );
    const open = (x: number, y: number) => x >= 0 && y >= 0 && x < map.w && y < map.h && map.rows[y][x] === ".";
    let ok = 0, rejected = 0;
    const timings: number[] = [];
    const errors = new Map<string, number>();

    for (let cycle = 0; cycle < 240; cycle++) {
      await f.db.advance(1000);
      if (cycle % 10 === 0) await keepAlive(f.db, f.gameId);
      const phase = (await f.db.sql<{ phase: string }>(`select phase from public.games where id = $1`, [f.gameId]))[0].phase;
      if (phase === "finished") break;
      // Chaque cycle : 5 joueurs aléatoires agissent.
      for (let k = 0; k < 5; k++) {
        const u = all[Math.floor(rnd() * all.length)];
        const me = (await f.db.sql<Json>(`select * from public.player_states where game_id = $1 and user_id = $2`, [f.gameId, u.id]))[0];
        if (me.status !== "active") continue;
        const t0 = performance.now();
        try {
          const roll = rnd();
          if (me.team === "hunter" && roll < 0.15) {
            await f.db.as(u).rpc("attempt_capture", { p_game: f.gameId });
          } else if (roll < 0.2) {
            const keys = me.team === "hunter" ? ["tracker", "scan"] : ["ghost", "sprint", "jammer"];
            const key = keys[Math.floor(rnd() * keys.length)];
            await f.db.as(u).rpc("use_ability", {
              p_game: f.gameId,
              p_key: key,
              p_target: key === "scan" ? { x: me.x, y: me.y } : null,
            });
          } else {
            const path: number[][] = [];
            let cx = me.x, cy = me.y;
            const len = 1 + Math.floor(rnd() * 2);
            for (let s = 0; s < len; s++) {
              const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => open(cx + dx, cy + dy));
              if (!dirs.length) break;
              const [dx, dy] = dirs[Math.floor(rnd() * dirs.length)];
              cx += dx; cy += dy;
              path.push([cx, cy]);
            }
            if (path.length) await f.db.as(u).rpc("move", { p_game: f.gameId, p_path: path });
          }
          ok++;
        } catch (e) {
          rejected++;
          const code = (e as { code: string }).code;
          errors.set(code, (errors.get(code) ?? 0) + 1);
        }
        timings.push(performance.now() - t0);
      }
      await f.db.as(all[cycle % all.length]).rpc("game_tick", { p_game: f.gameId }).catch(() => undefined);
    }

    // Invariants
    const ps = await f.db.sql<Json>(`select * from public.player_states where game_id = $1`, [f.gameId]);
    for (const p of ps) {
      expect(open(p.x, p.y)).toBe(true);
      expect(p.steps).toBeGreaterThanOrEqual(0);
      expect(["active", "captured", "abandoned"]).toContain(p.status);
    }
    const seqs = await f.db.sql<{ stream: string; sns: string[] }>(
      `select stream, array_agg(sn order by sn) sns from public.game_events where game_id = $1 group by stream`,
      [f.gameId],
    );
    for (const s of seqs) {
      const sns = s.sns.map(Number);
      expect(sns).toEqual(Array.from({ length: sns.length }, (_, i) => i + 1));
    }
    // Erreurs attendues uniquement (règles du jeu), aucune erreur interne.
    const allowed = new Set(["E_COOLDOWN", "E_NOT_ENOUGH_STEPS", "E_NO_USES_LEFT", "E_BLOCKED", "E_RATE_LIMITED", "E_NOT_ACTIVE", "E_CANNOT_CAPTURE_NOW", "E_PHASE", "E_CANNOT_MOVE_NOW"]);
    for (const code of errors.keys()) expect(allowed.has(code), `erreur inattendue ${code}`).toBe(true);

    const radar = await f.db.sql<Json>(`select count(*)::int n from public.radar_pulses where game_id = $1`, [f.gameId]);
    const [usage] = await f.db.sql<Json>(`select sum(broadcasts)::int b, sum(delivered_estimate)::int d from private.usage_daily`);
    timings.sort((a, b) => a - b);
    const p50 = timings[Math.floor(timings.length * 0.5)], p95 = timings[Math.floor(timings.length * 0.95)];
    console.log(
      `[simulation] actions acceptées=${ok} refusées=${rejected} (${JSON.stringify(Object.fromEntries(errors))}) ` +
        `radar=${radar[0].n} broadcasts=${usage.b} livraisons estimées=${usage.d} ` +
        `RPC PGlite p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );
    expect(ok).toBeGreaterThan(500);
    expect(radar[0].n).toBeGreaterThanOrEqual(5);
  }, 300_000);
});
