/**
 * Construction des couches GeoJSON du jeu à partir de l'état autorisé reçu du
 * serveur. Fonctions pures (testées) : le composant carte ne fait que les
 * transmettre à MapLibre.
 *
 * Rien ici n'invente d'information : seules les positions présentes dans
 * l'état (coéquipiers, adversaires visibles, contacts radar, révélations)
 * sont dessinées.
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { inRadius, visibilityMask } from "../engine/grid";
import { DIR_ANGLE, contactRect, enemyOf } from "../engine/rules";
import type { Cell, MapData, Team } from "../engine/types";
import type { GameState } from "../game/state";
import { cellCenter, cellRectRing, circleRing, destination, geoOf, maskToRings, type LngLat } from "./geo";

export const GAME_COLORS = {
  volt: "#2f6bff",
  ally: "#5b8cff",
  hunter: "#ff5a4e",
  fugitive: "#4fd1a5",
  warn: "#e8b14a",
  ivory: "#ece8df",
  fog: "#050608",
} as const;

export type FC = FeatureCollection<Geometry, Record<string, unknown>>;
const fc = (features: Feature<Geometry, Record<string, unknown>>[]): FC => ({ type: "FeatureCollection", features });
const poly = (rings: LngLat[][], props: Record<string, unknown> = {}) =>
  rings.map((r) => ({ type: "Feature" as const, properties: props, geometry: { type: "Polygon" as const, coordinates: [r] } }));

export function enemyColor(myTeam: Team): string {
  return GAME_COLORS[enemyOf(myTeam)];
}

/** Masque hors zone (monde moins le disque de jeu) + contour de la zone. */
export function zoneLayers(map: MapData): { mask: FC; outline: FC } {
  const g = geoOf(map);
  const ring = circleRing([g.lng, g.lat], g.radius_m, 128);
  const world: LngLat[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  return {
    mask: fc([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, [...ring].reverse()] } }]),
    outline: fc([{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } }]),
  };
}

export function forbiddenLayer(map: MapData): FC {
  return fc(poly(maskToRings(map, (x, y) => map.rows[y][x] === "~")));
}

/** Brouillard : cases jouables hors de la vision de l'équipe. */
export function fogLayer(s: GameState): FC {
  if (s.game.phase === "finished") return fc([]);
  const map = s.game.map;
  const team = s.me.team;
  const viewers = Object.values(s.allies).filter((a) => a.status === "active" && a.team === team);
  const mask = visibilityMask(map, viewers, team === "hunter" ? s.game.config.vision_hunter : s.game.config.vision_fugitive);
  return fc(poly(maskToRings(map, (x, y) => map.rows[y][x] !== "#" && !mask[y * map.w + x])));
}

export function cellsLayer(map: MapData, cells: Iterable<string>): FC {
  const set = new Set(cells);
  return fc(poly(maskToRings(map, (x, y) => set.has(`${x},${y}`))));
}

export function effectsLayer(s: GameState, now: number): FC {
  return fc(
    s.effects.filter((e) => e.expires_at > now).flatMap((e) => poly([cellRectRing(s.game.map, e.x, e.y)], { kind: e.kind })),
  );
}

/** Contacts radar (secteurs/zones) et caps (radar directionnel, Traqueur). */
export function radarLayers(s: GameState, now: number): { areas: FC; bearings: FC } {
  const map = s.game.map;
  const g = geoOf(map);
  const color = enemyColor(s.me.team);
  const areas: Feature<Geometry, Record<string, unknown>>[] = [];
  const bearings: Feature<Geometry, Record<string, unknown>>[] = [];
  const bandM = (b: string) => (b === "near" ? 5 : b === "mid" ? 9 : 14) * g.cell_m;

  if (s.radar && s.radar.expires_at > now) {
    const fade = Math.min(1, (s.radar.expires_at - now) / 2500);
    const origin = cellCenter(map, s.radar.origin.x, s.radar.origin.y);
    for (const c of s.radar.contacts) {
      const rect = contactRect(c);
      if (rect) {
        areas.push(...poly([cellRectRing(map, rect.x, rect.y, rect.w, rect.h)], { color, opacity: fade }));
      } else if ("dir" in c && c.dir !== "here") {
        bearings.push({
          type: "Feature",
          properties: { color, opacity: fade },
          geometry: { type: "LineString", coordinates: [origin, destination(origin, DIR_ANGLE[c.dir], bandM(c.band))] },
        });
      }
    }
  }
  const t = s.tracker;
  if (t?.dir && t.dir !== "here" && t.band) {
    const origin = cellCenter(map, t.origin.x, t.origin.y);
    bearings.push({
      type: "Feature",
      properties: { color: GAME_COLORS.warn, opacity: 1 },
      geometry: { type: "LineString", coordinates: [origin, destination(origin, DIR_ANGLE[t.dir], bandM(t.band))] },
    });
  }
  return { areas: fc(areas), bearings: fc(bearings) };
}

export function revealLayer(s: GameState, now: number): FC {
  const map = s.game.map;
  const g = geoOf(map);
  return fc(
    s.reveals
      .filter((r) => r.expires_at > now)
      .map((r) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: circleRing(cellCenter(map, r.area.x, r.area.y), (r.area.r + 0.5) * g.cell_m) },
      })),
  );
}

/** Anneau de vision autour du joueur (repère discret). */
export function visionRing(s: GameState): FC {
  if (s.game.phase === "finished" || s.me.status !== "active") return fc([]);
  const g = geoOf(s.game.map);
  const r = s.me.team === "hunter" ? s.game.config.vision_hunter : s.game.config.vision_fugitive;
  return fc([
    {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: circleRing(cellCenter(s.game.map, s.me.x, s.me.y), (r + 0.5) * g.cell_m) },
    },
  ]);
}

export function trailsLayer(s: GameState, trails: Record<string, Cell[]>): FC {
  const map = s.game.map;
  const features: Feature<Geometry, Record<string, unknown>>[] = [];
  for (const [u, pts] of Object.entries(trails)) {
    if (pts.length < 2) continue;
    const team = s.players[u]?.team ?? s.allies[u]?.team ?? s.me.team;
    const color = u === s.me.u ? GAME_COLORS.volt : team === s.me.team ? GAME_COLORS.ally : GAME_COLORS[team];
    features.push({
      type: "Feature",
      properties: { color },
      geometry: { type: "LineString", coordinates: pts.map((p) => cellCenter(map, p.x, p.y)) },
    });
  }
  return fc(features);
}

export function pathLayer(s: GameState, path: Cell[] | null): FC {
  if (!path?.length) return fc([]);
  const map = s.game.map;
  const coords = [cellCenter(map, s.me.x, s.me.y), ...path.map((p) => cellCenter(map, p.x, p.y))];
  const end = path[path.length - 1];
  return fc([
    { type: "Feature", properties: { role: "line" }, geometry: { type: "LineString", coordinates: coords } },
    ...poly([cellRectRing(map, end.x, end.y)], { role: "end" }),
  ]);
}

/** Portée de ciblage (carré de Tchebychev) et rayon d'effet autour de la cible. */
export function targetLayer(s: GameState, target: { range: number; radius?: number } | null, hover: Cell | null): FC {
  if (!target) return fc([]);
  const map = s.game.map;
  const r = target.range;
  const features = poly([cellRectRing(map, s.me.x - r, s.me.y - r, 2 * r + 1, 2 * r + 1)], { role: "range" });
  if (hover && target.radius) {
    const rad = target.radius;
    features.push(
      ...poly(
        maskToRings(map, (x, y) => Math.abs(x - hover.x) <= rad && Math.abs(y - hover.y) <= rad && inRadius(x - hover.x, y - hover.y, rad)),
        { role: "area" },
      ),
    );
  }
  return fc(features);
}

/** Joueurs : moi, coéquipiers (bleu), adversaires visibles ou révélés. */
export function playersLayer(s: GameState, now: number): FC {
  const map = s.game.map;
  const finished = s.game.phase === "finished";
  const features: Feature<Geometry, Record<string, unknown>>[] = [];
  const eColor = enemyColor(s.me.team);
  const point = (x: number, y: number, props: Record<string, unknown>) =>
    features.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: cellCenter(map, x, y) } });

  for (const r of s.reveals) {
    if (r.expires_at <= now) continue;
    for (const c of r.contacts) point(c.x, c.y, { kind: "revealed", color: eColor, opacity: 1, label: "" });
  }
  for (const v of s.visible) point(v.x, v.y, { kind: "enemy", color: eColor, opacity: 1, label: s.players[v.u]?.username ?? "" });
  for (const a of Object.values(s.allies)) {
    if (a.u === s.me.u) continue;
    const ally = a.team === s.me.team && !finished;
    const ghost = !!a.ghost_until && a.ghost_until > now;
    point(a.x, a.y, {
      kind: a.status === "active" ? "ally" : "out",
      color: finished ? GAME_COLORS[a.team] : ally ? GAME_COLORS.ally : eColor,
      opacity: a.status !== "active" ? 0.4 : ghost ? 0.5 : 1,
      label: s.players[a.u]?.username ?? "",
    });
  }
  const meGhost = !!s.me.ghost_until && s.me.ghost_until > now;
  point(s.me.x, s.me.y, {
    kind: "me",
    color: finished ? GAME_COLORS[s.me.team] : GAME_COLORS.volt,
    opacity: s.me.status !== "active" ? 0.45 : meGhost ? 0.55 : 1,
    label: "",
  });
  return fc(features);
}

export function sweepRing(center: LngLat, radiusM: number): FC {
  return fc([{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: circleRing(center, Math.max(1, radiusM), 96) } }]);
}

export const EMPTY_FC: FC = fc([]);
