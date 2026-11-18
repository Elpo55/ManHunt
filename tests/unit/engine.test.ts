import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "@/lib/engine/config";
import { blockedSet, cellLabel, chebyshev, findPath, inRadius, reachable, visibilityMask } from "@/lib/engine/grid";
import {
  availableSteps,
  canTransition,
  contactRect,
  describeContact,
  formatClock,
  formatDuration,
  abilitiesFor,
  MODES,
} from "@/lib/engine/rules";
import type { MapData } from "@/lib/engine/types";

const map: MapData = {
  w: 6,
  h: 5,
  rows: [
    "......",
    ".##...",
    ".#..~.",
    ".#....",
    "......",
  ],
};

describe("grille", () => {
  it("calcule un plus court chemin qui contourne obstacles et zones interdites", () => {
    const p = findPath(map, { x: 0, y: 2 }, { x: 2, y: 2 })!;
    expect(p.at(-1)).toEqual({ x: 2, y: 2 });
    expect(p).toHaveLength(6); // contourne le mur par le bas
    for (const c of p) expect(map.rows[c.y][c.x]).toBe(".");
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y)).toBe(1);
  });

  it("refuse une cible bloquée ou inatteignable", () => {
    expect(findPath(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 4, y: 2 })).toBeNull();
    const blocked = blockedSet([{ id: "1", kind: "blocked", x: 3, y: 0, expires_at: 2000 }], 1000);
    expect(findPath(map, { x: 0, y: 0 }, { x: 3, y: 0 }, blocked)).toBeNull();
    expect(blockedSet([{ id: "1", kind: "blocked", x: 3, y: 0, expires_at: 500 }], 1000).size).toBe(0);
  });

  it("utilise le même disque de vision que le serveur", () => {
    expect(inRadius(2, 0, 2)).toBe(true);
    expect(inRadius(2, 1, 2)).toBe(true); // 5 <= 6
    expect(inRadius(2, 2, 2)).toBe(false); // 8 > 6
    const mask = visibilityMask(map, [{ x: 0, y: 0 }], 1);
    expect(Array.from(mask).reduce((a, b) => a + b, 0)).toBe(4); // coin : 2x2 (diagonale incluse)
  });

  it("calcule la portée atteignable en N pas", () => {
    const r = reachable(map, { x: 0, y: 0 }, 2);
    expect(r.has("2,0")).toBe(true);
    expect(r.has("0,2")).toBe(true);
    expect(r.has("1,1")).toBe(false);
    expect(r.has("3,0")).toBe(false);
  });

  it("utilitaires", () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: -2 })).toBe(3);
    expect(cellLabel(0, 0)).toBe("A1");
    expect(cellLabel(27, 9)).toBe("AB10");
  });
});

describe("pas disponibles", () => {
  const cfg = { max_steps: 4, step_regen_ms: 2000 };
  it("régénère 1 pas par intervalle, plafonné", () => {
    expect(availableSteps({ steps: 0, steps_at: 0 }, cfg, 1999).steps).toBe(0);
    expect(availableSteps({ steps: 0, steps_at: 0 }, cfg, 2000).steps).toBe(1);
    expect(availableSteps({ steps: 0, steps_at: 0 }, cfg, 2000).nextAt).toBe(4000);
    expect(availableSteps({ steps: 3, steps_at: 0 }, cfg, 99999)).toEqual({ steps: 4, nextAt: null });
  });
  it("double la vitesse sous Accélération", () => {
    expect(availableSteps({ steps: 0, steps_at: 0, boost_until: 10000 }, cfg, 3000).steps).toBe(3);
  });
});

describe("machine à états", () => {
  it("n'autorise que les transitions valides", () => {
    expect(canTransition("lobby", "preparation")).toBe(true);
    expect(canTransition("preparation", "running")).toBe(true);
    expect(canTransition("running", "paused")).toBe(true);
    expect(canTransition("paused", "running")).toBe(true);
    expect(canTransition("running", "finished")).toBe(true);
    expect(canTransition("finished", "results")).toBe(true);
    expect(canTransition("results", "lobby")).toBe(true);
    expect(canTransition("finished", "running")).toBe(false);
    expect(canTransition("lobby", "finished")).toBe(false);
    expect(canTransition("results", "running")).toBe(false);
  });
});

describe("configuration", () => {
  it("borne les valeurs et complète les valeurs par défaut", () => {
    const c = normalizeConfig({ duration_s: 5, max_steps: 99, radar: { precision: "x", interval_s: 15.6 } });
    expect(c.duration_s).toBe(120);
    expect(c.max_steps).toBe(10);
    expect(c.radar.precision).toBe("sector");
    expect(c.radar.interval_s).toBe(16);
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig("garbage")).toEqual(DEFAULT_CONFIG);
  });
});

describe("radar et affichage", () => {
  it("décrit les contacts sans position exacte", () => {
    expect(describeContact({ jammed: true })).toBe("Signal brouillé");
    expect(describeContact({ dir: "NE", band: "far" })).toBe("Nord-Est, loin");
    expect(describeContact({ sx: 1, sy: 2, size: 6, cols: 4 })).toBe("Secteur B3");
    expect(contactRect({ sx: 1, sy: 2, size: 6, cols: 4 })).toEqual({ x: 6, y: 12, w: 6, h: 6 });
    expect(contactRect({ x0: 3, y0: 4, size: 5 })).toEqual({ x: 3, y: 4, w: 5, h: 5 });
    expect(contactRect({ dir: "N", band: "near" })).toBeNull();
  });
  it("formate le temps", () => {
    expect(formatClock(61_000)).toBe("01:01");
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(59_001)).toBe("01:00");
    expect(formatDuration(3725)).toBe("1 h 2 min");
  });
  it("expose les capacités par équipe et les modes disponibles", () => {
    expect(abilitiesFor("hunter").map((a) => a.key)).toEqual(["scan", "tracker", "barrier"]);
    expect(abilitiesFor("fugitive").map((a) => a.key)).toEqual(["ghost", "jammer", "sprint"]);
    expect(MODES.filter((m) => m.available).map((m) => m.id)).toEqual(["classic", "infection"]);
  });
});
