/** Garantit que la normalisation TS (UI) et SQL (serveur) sont identiques. */
import { describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { normalizeConfig } from "@/lib/engine/config";

const samples: unknown[] = [
  {},
  { duration_s: 99999, prep_s: -3, max_steps: 0, obstacle_density: 0.999, hunter_ratio: 0.333 },
  { mode: "infection", map_size: "l", radar: { mode: "manual", teams: "both", interval_s: 14, precision: "zone", max_uses: 3 } },
  { abilities: { ghost: { enabled: false, cooldown_s: 1, max_uses: 50 }, scan: { duration_s: 500 } } },
  { mode: "royale", map_size: "xl", radar: "nope", abilities: [] },
  { vision_hunter: 2.5, vision_fugitive: 3.4, capture_range: 1.5, step_regen_ms: 1234.5 },
];

describe("parité configuration TS <-> SQL", () => {
  it("produit exactement la même configuration normalisée", async () => {
    const db = await TestDb.create();
    for (const s of samples) {
      const [{ c }] = await db.sql<{ c: unknown }>(`select private.normalize_config($1::jsonb) c`, [JSON.stringify(s)]);
      expect(normalizeConfig(s)).toEqual(c);
    }
  });

  it("les valeurs par défaut des capacités correspondent au catalogue SQL", async () => {
    const db = await TestDb.create();
    const rows = await db.sql<{ key: string; duration_s: number; cooldown_s: number; max_uses: number }>(
      `select key, duration_s, cooldown_s, max_uses from public.abilities`,
    );
    const ts = normalizeConfig({}).abilities as Record<string, { duration_s: number; cooldown_s: number; max_uses: number }>;
    for (const r of rows) {
      expect(ts[r.key]).toMatchObject({ duration_s: r.duration_s, cooldown_s: r.cooldown_s, max_uses: r.max_uses });
    }
  });
});
