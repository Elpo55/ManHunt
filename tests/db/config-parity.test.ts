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
  // v0.4.0 : zones polygonales et interdites, modes, objectifs, spectateurs, rendez-vous.
  {
    mode: "misterx",
    capture_method: "qr",
    gps_silent_s: 30,
    zone: {
      lat: 48.85, lng: 2.29, radius_m: 600, set: true, shape: "polygon",
      polygon: [{ lat: 48.851, lng: 2.291 }, { lat: 48.852, lng: 2.2934567891 }, "x", { lat: 48.849, lng: 2.288 }, { lat: 1 }],
      forbidden: [
        { kind: "circle", lat: 48.8505, lng: 2.29, radius_m: 5, label: "  Bassin " },
        { kind: "polygon", points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], label: "trop court" },
        { kind: "polygon", points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 1.5 }] },
        { lat: "nope" },
        42,
      ],
    },
    misterx: { reveal_interval_s: 10_000 },
  },
  { zone: { shape: "polygon", polygon: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] } },
  {
    mode: "royale",
    royale: { stages: 9, final_ratio: 0.123, warn_s: 1 },
    objectives: {
      enabled: true, radius_m: 1, points_each: 9999, win_on_all: true, extraction_open_s: 5, extraction_bonus: -1,
      beacons: [{ lat: 48.1, lng: 2.1, label: "<b>Fontaine</b>" }, { lat: 48.2 }, { lat: 48.3, lng: 2.3 }, null],
      extraction: { set: true, lat: 48.4, lng: 2.4, label: "" },
    },
    spectators: { enabled: false, delay_s: 1 },
    replay: { enabled: false },
    rendezvous: { set: true, lat: 48.5, label: "Sans longitude" },
  },
  { objectives: "x", royale: [], misterx: null, spectators: 3, rendezvous: { set: true, lat: 48.5, lng: 2.5, label: "Kiosque" } },
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
