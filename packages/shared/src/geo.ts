/**
 * Géographie locale (projection équirectangulaire, précise à quelques
 * centimètres près sur une zone de jeu de quelques kilomètres).
 * Formules identiques à la migration 0800 (private.dist_m, bearing_deg…).
 */
import type { Dir8, DistanceBand, LatLng } from "./types";

export type LngLat = [number, number];
export const M_PER_DEG_LAT = 111_320;

const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dx = (b.lng - a.lng) * M_PER_DEG_LAT * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dx, (b.lat - a.lat) * M_PER_DEG_LAT);
}

/** Cap de A vers B en degrés (0 = Nord, sens horaire). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const deg = (Math.atan2((b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2)), b.lat - a.lat) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export const DIRS: Dir8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const DIR_ANGLE: Record<Dir8, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

export function dir8(bearing: number): Dir8 {
  return DIRS[Math.floor((((bearing + 22.5) % 360) + 360) % 360 / 45)];
}

export function band(distance: number): DistanceBand {
  return distance < 100 ? "near" : distance < 300 ? "mid" : "far";
}

/** Point situé à `distance` m dans la direction `bearing`. */
export function destination(origin: LatLng, bearing: number, distance: number): LatLng {
  const east = Math.sin(rad(bearing)) * distance;
  const north = Math.cos(rad(bearing)) * distance;
  return {
    lat: origin.lat + north / M_PER_DEG_LAT,
    lng: origin.lng + east / (M_PER_DEG_LAT * Math.cos(rad(origin.lat))),
  };
}

/** Anneau GeoJSON (fermé) d'un cercle. */
export function circleRing(center: LatLng, radiusM: number, steps = 72): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(center, (i / steps) * 360, radiusM);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

/** Part de disque (secteur radar k ∈ [0,7] centré sur N, NE…), entre deux rayons. */
export function sectorRing(center: LatLng, k: number, innerM: number, outerM: number, steps = 12): LngLat[] {
  const start = k * 45 - 22.5;
  const outer: LngLat[] = [];
  const inner: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const b = start + (45 * i) / steps;
    const o = destination(center, b, outerM);
    outer.push([o.lng, o.lat]);
    if (innerM > 0) {
      const n = destination(center, b, innerM);
      inner.unshift([n.lng, n.lat]);
    }
  }
  const ring = innerM > 0 ? [...outer, ...inner] : [[center.lng, center.lat] as LngLat, ...outer];
  ring.push(ring[0]);
  return ring;
}

export function zoneBounds(center: LatLng, radiusM: number, margin = 0.15): { ne: LngLat; sw: LngLat } {
  const r = radiusM * (1 + margin);
  const n = destination(center, 0, r);
  const e = destination(center, 90, r);
  const s = destination(center, 180, r);
  const w = destination(center, 270, r);
  return { ne: [e.lng, n.lat], sw: [w.lng, s.lat] };
}

export function isInsideZone(p: LatLng, zone: LatLng & { radius_m: number }, accuracy = 0): boolean {
  return distanceM(zone, p) <= zone.radius_m + Math.min(accuracy, 50);
}

/** Une position est obsolète si elle date de plus de `staleAfterS` secondes. */
export function isStale(at: number | null | undefined, now: number, staleAfterS: number): boolean {
  return !at || now - at > staleAfterS * 1000;
}

export function formatMeters(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (m < 1000) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace(".", ",")} km`;
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.floor(s / 60);
  return `il y a ${m} min`;
}
