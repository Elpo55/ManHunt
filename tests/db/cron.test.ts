/** Le script optionnel pg_cron fait avancer les parties sans aucun client. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { gamePhase, keepAlive, setupGame, skipPreparation } from "./fixtures";

it("cron_tick_all termine une partie dont le temps est écoulé", async () => {
  const f = await setupGame({ config: { duration_s: 300 } });
  const sql = readFileSync(join(import.meta.dirname, "..", "..", "supabase", "optional", "pg_cron_jobs.sql"), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(create extension|select cron\.)/i.test(l))
    .join("\n");
  await f.db.pg.exec(sql);
  await skipPreparation(f);
  await f.db.advance(301_000);
  await keepAlive(f.db, f.gameId);
  await f.db.sql(`select private.cron_tick_all()`);
  expect(await gamePhase(f.db, f.gameId)).toBe("finished");
});
