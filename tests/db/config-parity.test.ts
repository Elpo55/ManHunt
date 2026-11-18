/** Garantit que la normalisation TS (UI) et SQL (serveur) sont identiques. */
import { describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { normalizeConfig } from "@shared/config";

const samples: unknown[] = [
  {},
  { duration_s: 99999, prep_s: -3, approx_m: 0, hunter_ratio: 0.333, capture_radius_m: 15.5 },
  { mode: "infection", enemy_reveal: "pulse", radar: { mode: "manual", teams: "both", interval_s: 14, precision: "zone", max_uses: 3 } },
  { abilities: { ghost: { enabled: false, cooldown_s: 1, max_uses: 50 }, scan: { duration_s: 500 } } },
  { mode: "royale", enemy_reveal: "x", radar: "nope", abilities: [] },
  { zone: { lat: 48.123456789, lng: 2.987654321, radius_m: 1234.5, label: "  Parc <des> \"Buttes\"  ", set: true } },
  { zone: { lat: -99, lng: 200, radius_m: 10, label: "" } },
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
      `select key, duration_s, cooldown_s, max_uses from public.abilities where enabled`,
    );
    const ts = normalizeConfig({}).abilities as Record<string, { duration_s: number; cooldown_s: number; max_uses: number }>;
    for (const r of rows) {
      expect(ts[r.key]).toMatchObject({ duration_s: r.duration_s, cooldown_s: r.cooldown_s, max_uses: r.max_uses });
    }
  });
});
