import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  applyPreset,
  band,
  bearingDeg,
  buildDarkStyle,
  canTransition,
  circleRing,
  describeContact,
  destination,
  dir8,
  distanceM,
  formatAge,
  formatClock,
  formatMeters,
  isInsideZone,
  isStale,
  normalizeConfig,
  parseNominatim,
  resolveProvider,
  sectorRing,
  createGeocoder,
  abilitiesFor,
  MODES,
} from "@shared";

const PARIS = { lat: 48.8556, lng: 2.2986 };

describe("géographie", () => {
  it("distance, cap et destination sont cohérents", () => {
    const north = destination(PARIS, 0, 250);
    const east = destination(PARIS, 90, 400);
    expect(distanceM(PARIS, north)).toBeCloseTo(250, 0);
    expect(distanceM(PARIS, east)).toBeCloseTo(400, 0);
    expect(dir8(bearingDeg(PARIS, north))).toBe("N");
    expect(dir8(bearingDeg(PARIS, east))).toBe("E");
    expect(dir8(bearingDeg(PARIS, destination(PARIS, 135, 100)))).toBe("SE");
    expect(dir8(359)).toBe("N");
    expect([band(50), band(150), band(500)]).toEqual(["near", "mid", "far"]);
  });

  it("cercles et secteurs fermés aux bons rayons", () => {
    const ring = circleRing(PARIS, 300, 36);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lng, lat] of ring) expect(distanceM(PARIS, { lat, lng })).toBeCloseTo(300, 0);
    const pie = sectorRing(PARIS, 2, 0, 500);
    expect(pie[0]).toEqual(pie[pie.length - 1]);
    const donut = sectorRing(PARIS, 2, 250, 500);
    expect(donut.length).toBeGreaterThan(pie.length);
  });

  it("zone, obsolescence et formats", () => {
    const zone = { ...PARIS, radius_m: 500 };
    expect(isInsideZone(destination(PARIS, 10, 490), zone)).toBe(true);
    expect(isInsideZone(destination(PARIS, 10, 560), zone)).toBe(false);
    expect(isInsideZone(destination(PARIS, 10, 530), zone, 40)).toBe(true);
    expect(isStale(1000, 50_000, 45)).toBe(true);
    expect(isStale(10_000, 50_000, 45)).toBe(false);
    expect(isStale(null, 1, 45)).toBe(true);
    expect(formatMeters(1234)).toBe("1,2 km");
    expect(formatMeters(42)).toBe("40 m");
    expect(formatAge(2000)).toBe("à l'instant");
    expect(formatAge(75_000)).toBe("il y a 1 min");
  });
});

describe("configuration", () => {
  it("borne, complète et ne garde que les capacités GPS", () => {
    const c = normalizeConfig({ duration_s: 10, approx_m: 1, zone: { lat: 99, lng: 2, radius_m: 9999, label: "<b>x</b>" } });
    expect(c.duration_s).toBe(300);
    expect(c.approx_m).toBe(10);
    expect(c.zone).toEqual({ lat: 85, lng: 2, radius_m: 3000, label: "bx/b", set: false });
    expect(Object.keys(c.abilities).sort()).toEqual(["decoy", "ghost", "jammer", "scan", "sonar", "tracker"]);
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it("un préréglage conserve le lieu et le mode", () => {
    const base = normalizeConfig({ mode: "infection", zone: { ...PARIS, radius_m: 700, label: "Test", set: true } });
    const p = applyPreset(base, "quartier");
    expect(p.zone).toMatchObject({ lat: PARIS.lat, lng: PARIS.lng, radius_m: 300, set: true });
    expect(p.mode).toBe("infection");
    expect(p.duration_s).toBe(1200);
  });
});

describe("règles et libellés", () => {
  it("machine à états, modes, capacités, radar", () => {
    expect(canTransition("lobby", "preparation")).toBe(true);
    expect(canTransition("finished", "running")).toBe(false);
    expect(MODES.filter((m) => m.available).map((m) => m.id)).toEqual(["classic", "infection"]);
    expect(abilitiesFor("hunter").map((a) => a.key)).toEqual(["scan", "tracker", "sonar"]);
    expect(abilitiesFor("fugitive").map((a) => a.key)).toEqual(["ghost", "jammer", "decoy"]);
    expect(describeContact({ dir: "NE", band: "mid", dist_m: 250 })).toBe("Nord-Est, ~250 m");
    expect(describeContact({ sector: 4, ring: 1 })).toBe("Secteur Sud (périphérie)");
    expect(describeContact({ lost: true })).toBe("Signal perdu");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});

describe("cartographie interchangeable", () => {
  it("résout le fournisseur depuis l'environnement, sans réécrire le style", () => {
    expect(resolveProvider({}).id).toBe("openfreemap");
    const mt = resolveProvider({ MAP_PROVIDER: "maptiler", MAPTILER_KEY: "abc" });
    expect(mt.tilesUrl).toContain("api.maptiler.com");
    expect(resolveProvider({ MAP_PROVIDER: "maptiler" }).id).toBe("openfreemap"); // sans clé : repli
    const custom = resolveProvider({ MAP_PROVIDER: "custom", MAP_TILES_URL: "https://tiles.example/planet.json" });
    expect(custom.tilesUrl).toBe("https://tiles.example/planet.json");
    const style = buildDarkStyle(mt);
    expect(JSON.stringify(style)).toContain("api.maptiler.com");
    expect((style.layers as { id: string }[]).map((l) => l.id)).toContain("building");
  });

  it("géocodage : analyse, limitation et User-Agent identifié", async () => {
    const places = parseNominatim([
      { display_name: "Champ-de-Mars, Paris, Île-de-France, France", lat: "48.85", lon: "2.29", boundingbox: ["48.853", "48.859", "2.29", "2.30"] },
    ]);
    expect(places[0]).toMatchObject({ label: "Champ-de-Mars, Paris, Île-de-France", lat: 48.85, suggestedRadius: 350 });
    const calls: { url: string; ua: string }[] = [];
    const search = createGeocoder({
      userAgent: "ProjetTraque/0.2",
      fetchImpl: (async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, ua: init.headers["User-Agent"] });
        return { ok: true, json: async () => [] };
      }) as unknown as typeof fetch,
    });
    await search("Lyon");
    await search("lyon"); // cache
    expect(calls).toHaveLength(1);
    expect(calls[0].ua).toBe("ProjetTraque/0.2");
    expect(await search("ab")).toEqual([]);
  });
});
