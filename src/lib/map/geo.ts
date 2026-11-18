/**
 * Conversions entre le maillage virtuel du jeu (cases) et les coordonnées
 * géographiques réelles servant uniquement à l'AFFICHAGE.
 *
 * Projection équirectangulaire locale autour du centre de la zone : erreur
 * inférieure au mètre pour des zones de quelques kilomètres. Formules
 * identiques à private.generate_zone_map (migration 0800) :
 *   dx = (x + 0.5 - w/2) * cell_m   (Est positif)
 *   dy = (y + 0.5 - h/2) * cell_m   (Sud positif)
 *
 * Aucune position GPS n'est lue : le jeu ne connaît que ces cases.
 */
import type { Cell, MapData, MapGeo } from "../engine/types";

export type LngLat = [number, number];

/** Mètres par degré de latitude (sphère moyenne). */
export const M_PER_DEG_LAT = 111_320;

export const FALLBACK_GEO: MapGeo = { lat: 48.8556, lng: 2.347, radius_m: 600, cell_m: 30 };

export function geoOf(map: MapData): MapGeo {
  return map.geo ?? { ...FALLBACK_GEO, cell_m: (2 * FALLBACK_GEO.radius_m) / map.w };
}

function mPerDegLng(lat: number) {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Décalage en mètres (Est, Sud) depuis le centre -> [lng, lat]. */
export function offsetToLngLat(geo: Pick<MapGeo, "lat" | "lng">, east: number, south: number): LngLat {
  return [geo.lng + east / mPerDegLng(geo.lat), geo.lat - south / M_PER_DEG_LAT];
}

/** [lng, lat] -> décalage en mètres (Est, Sud) depuis le centre. */
export function lngLatToOffset(geo: Pick<MapGeo, "lat" | "lng">, [lng, lat]: LngLat): { east: number; south: number } {
  return { east: (lng - geo.lng) * mPerDegLng(geo.lat), south: (geo.lat - lat) * M_PER_DEG_LAT };
}

/** Coin nord-ouest d'une case (x, y) en mètres. */
function cornerOffset(map: MapData, x: number, y: number) {
  const g = geoOf(map);
  return { east: (x - map.w / 2) * g.cell_m, south: (y - map.h / 2) * g.cell_m };
}

/** Centre géographique d'une case (coordonnées fractionnaires acceptées). */
export function cellCenter(map: MapData, x: number, y: number): LngLat {
  const g = geoOf(map);
  return offsetToLngLat(g, (x + 0.5 - map.w / 2) * g.cell_m, (y + 0.5 - map.h / 2) * g.cell_m);
}

/** Case contenant un point géographique (peut être hors grille). */
export function lngLatToCell(map: MapData, p: LngLat): Cell {
  const g = geoOf(map);
  const o = lngLatToOffset(g, p);
  return { x: Math.floor(o.east / g.cell_m + map.w / 2), y: Math.floor(o.south / g.cell_m + map.h / 2) };
}

/** Rectangle de cases [x, x+w) x [y, y+h) -> polygone GeoJSON (anneau fermé). */
export function cellRectRing(map: MapData, x: number, y: number, w = 1, h = 1): LngLat[] {
  const g = geoOf(map);
  const a = cornerOffset(map, x, y);
  const e2 = a.east + w * g.cell_m;
  const s2 = a.south + h * g.cell_m;
  return [
    offsetToLngLat(g, a.east, a.south),
    offsetToLngLat(g, e2, a.south),
    offsetToLngLat(g, e2, s2),
    offsetToLngLat(g, a.east, s2),
    offsetToLngLat(g, a.east, a.south),
  ];
}

/** Cercle géographique (anneau fermé) de rayon en mètres. */
export function circleRing(center: LngLat, radiusM: number, steps = 72): LngLat[] {
  const c = { lng: center[0], lat: center[1] };
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push(offsetToLngLat(c, Math.sin(a) * radiusM, -Math.cos(a) * radiusM));
  }
  return ring;
}

/** Point à une distance et un cap (degrés, 0 = Nord) d'une origine. */
export function destination(origin: LngLat, bearingDeg: number, distanceM: number): LngLat {
  const a = (bearingDeg * Math.PI) / 180;
  return offsetToLngLat({ lng: origin[0], lat: origin[1] }, Math.sin(a) * distanceM, -Math.cos(a) * distanceM);
}

/** Emprise de la zone [[ouest, sud], [est, nord]] avec marge relative. */
export function zoneBounds(geo: Pick<MapGeo, "lat" | "lng" | "radius_m">, margin = 0.15): [LngLat, LngLat] {
  const r = geo.radius_m * (1 + margin);
  const sw = offsetToLngLat(geo, -r, r);
  const ne = offsetToLngLat(geo, r, -r);
  return [sw, ne];
}

/** Distance en mètres entre deux points proches (équirectangulaire). */
export function distanceM(a: LngLat, b: LngLat): number {
  const o = lngLatToOffset({ lng: a[0], lat: a[1] }, b);
  return Math.hypot(o.east, o.south);
}

/**
 * Regroupe des cases (masque) en rectangles horizontaux pour produire peu de
 * polygones (brouillard, zones interdites, portée).
 */
export function maskToRings(map: MapData, include: (x: number, y: number) => boolean): LngLat[][] {
  const rings: LngLat[][] = [];
  for (let y = 0; y < map.h; y++) {
    let start = -1;
    for (let x = 0; x <= map.w; x++) {
      const on = x < map.w && include(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        rings.push(cellRectRing(map, start, y, x - start, 1));
        start = -1;
      }
    }
  }
  return rings;
}

export function formatMeters(m: number): string {
  if (m < 1000) return `${Math.round(m / 5) * 5} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace(".", ",")} km`;
}
