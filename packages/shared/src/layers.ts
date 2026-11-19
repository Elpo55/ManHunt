/**
 * Couches GeoJSON de la carte de jeu, construites à partir de l'état
 * autorisé reçu du serveur (fonctions pures, testées). Indépendant du moteur
 * d'affichage : utilisées par MapLibre React Native.
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { circleRing, destination, DIR_ANGLE, isStale, sectorRing, type LngLat } from "./geo";
import { enemyOf } from "./rules";
import type { GameState, Objective, TeamMarker, ZoneCircle } from "./state";
import { myDisplayPosition } from "./state";
import type { GameZone, LatLng, Team } from "./types";

export const MAP_COLORS = {
  volt: "#2f6bff",
  ally: "#5b8cff",
  hunter: "#ff5a4e",
  fugitive: "#4fd1a5",
  warn: "#e8b14a",
  ivory: "#ece8df",
  stale: "#5d636e",
  abyss: "#050608",
} as const;

export type FC = FeatureCollection<Geometry, Record<string, unknown>>;
const fc = (features: Feature<Geometry, Record<string, unknown>>[]): FC => ({ type: "FeatureCollection", features });
const polygon = (ring: LngLat[], props: Record<string, unknown> = {}): Feature<Geometry, Record<string, unknown>> => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: [ring] },
});
const line = (coords: LngLat[], props: Record<string, unknown> = {}): Feature<Geometry, Record<string, unknown>> => ({
  type: "Feature",
  properties: props,
  geometry: { type: "LineString", coordinates: coords },
});
const point = (p: LatLng, props: Record<string, unknown>): Feature<Geometry, Record<string, unknown>> => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Point", coordinates: [p.lng, p.lat] },
});

export const EMPTY_FC: FC = fc([]);

export function enemyColor(myTeam: Team): string {
  return MAP_COLORS[enemyOf(myTeam)];
}

/** Zone de jeu : contour + masque assombrissant l'extérieur. */
export function zoneLayers(zone: LatLng & { radius_m: number }): { outline: FC; mask: FC } {
  const ring = circleRing(zone, zone.radius_m, 128);
  const world: LngLat[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return {
    outline: fc([line(ring)]),
    mask: fc([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, [...ring].reverse()] } }]),
  };
}

/**
 * Joueurs visibles + cercles de précision. Une position obsolète est grisée
 * et n'est jamais présentée comme « en mouvement ».
 */
export function playerLayers(s: GameState, now: number): { points: FC; accuracy: FC } {
  const stale = s.game.config.stale_after_s;
  const eColor = enemyColor(s.me.team);
  const pts: Feature<Geometry, Record<string, unknown>>[] = [];
  const acc: Feature<Geometry, Record<string, unknown>>[] = [];
  const add = (p: LatLng, accuracy: number | undefined, props: Record<string, unknown>) => {
    pts.push(point(p, props));
    if (accuracy && accuracy >= 10) acc.push(polygon(circleRing(p, accuracy, 48), { color: props.color, stale: props.stale }));
  };

  for (const [u, p] of Object.entries(s.allies)) {
    if (p.lat == null || p.lng == null) continue;
    const old = isStale(p.at, now, stale);
    add({ lat: p.lat, lng: p.lng }, p.acc, {
      kind: "ally", u, stale: old, color: old ? MAP_COLORS.stale : MAP_COLORS.ally, label: s.players[u]?.username ?? "",
    });
  }
  for (const [u, p] of Object.entries(s.enemies)) {
    if (p.hidden || p.lat == null || p.lng == null) continue;
    const old = isStale(p.at, now, stale);
    add({ lat: p.lat, lng: p.lng }, p.acc, {
      kind: "enemy", u, stale: old, color: old ? MAP_COLORS.stale : eColor, label: s.players[u]?.username ?? "",
    });
  }
  for (const r of s.reveals) {
    if (r.expires_at <= now) continue;
    for (const c of r.contacts) if (c.lat != null && c.lng != null) add({ lat: c.lat, lng: c.lng }, c.acc, { kind: "revealed", color: eColor, stale: false, label: "" });
  }
  const me = myDisplayPosition(s);
  if (me) {
    const old = s.device ? false : isStale(s.me.pos_at, now, stale);
    add(me, me.acc ?? undefined, { kind: "me", color: old ? MAP_COLORS.stale : MAP_COLORS.volt, stale: old, label: "" });
  }
  return { points: fc(pts), accuracy: fc(acc) };
}

/** Résultats radar : caps, secteurs, zones ; Traqueur ; Scan. */
export function radarLayers(s: GameState, now: number): { areas: FC; bearings: FC } {
  const areas: Feature<Geometry, Record<string, unknown>>[] = [];
  const bearings: Feature<Geometry, Record<string, unknown>>[] = [];
  const color = enemyColor(s.me.team);
  const zone = s.game.zone;
  const lenFor = (b: string, dist?: number) => dist ?? (b === "near" ? 80 : b === "mid" ? 200 : 400);

  if (s.radar && s.radar.expires_at > now) {
    const fade = Math.min(1, (s.radar.expires_at - now) / 3000);
    for (const c of s.radar.contacts) {
      if ("dir" in c && s.radar.origin) {
        const end = destination(s.radar.origin, DIR_ANGLE[c.dir], Math.max(60, lenFor(c.band, c.dist_m)));
        bearings.push(line([[s.radar.origin.lng, s.radar.origin.lat], [end.lng, end.lat]], { color, opacity: fade }));
      } else if ("sector" in c) {
        const inner = c.ring === 0 ? 0 : zone.radius_m / 2;
        const outer = c.ring === 0 ? zone.radius_m / 2 : zone.radius_m;
        areas.push(polygon(sectorRing(zone, c.sector, inner, outer), { color, opacity: fade }));
      } else if ("r_m" in c) {
        areas.push(polygon(circleRing(c, c.r_m, 64), { color, opacity: fade }));
      }
    }
  }
  if (s.hint?.kind === "tracker") {
    const d = s.hint.data as { dir?: keyof typeof DIR_ANGLE; band?: string; dist_m?: number; origin?: LatLng };
    if (d.dir && d.origin) {
      const end = destination(d.origin, DIR_ANGLE[d.dir], Math.max(60, lenFor(d.band ?? "mid", d.dist_m)));
      bearings.push(line([[d.origin.lng, d.origin.lat], [end.lng, end.lat]], { color: MAP_COLORS.warn, opacity: 1 }));
    }
  }
  for (const r of s.reveals) {
    if (r.expires_at > now) areas.push(polygon(circleRing(r.center, r.radius_m, 64), { color: MAP_COLORS.volt, opacity: 0.6 }));
  }
  return { areas: fc(areas), bearings: fc(bearings) };
}

/** Rayon de capture autour de moi (Chasseur). */
export function captureRing(s: GameState): FC {
  const me = myDisplayPosition(s);
  if (!me || s.me.team !== "hunter" || s.game.phase !== "running" || s.me.status !== "active") return EMPTY_FC;
  return fc([line(circleRing(me, s.game.config.capture_radius_m, 48))]);
}

export function sweepRing(center: LatLng, radiusM: number): FC {
  return fc([line(circleRing(center, Math.max(1, radiusM), 96))]);
}

const WORLD: LngLat[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
const closed = (pts: LatLng[]): LngLat[] => {
  const ring = pts.map((p) => [p.lng, p.lat] as LngLat);
  if (ring.length) ring.push(ring[0]);
  return ring;
};

/**
 * Aire de jeu effective : polygone ou cercle (zone courante en Royale), masque
 * extérieur, zones interdites hachurées, prochain cercle Royale en pointillés.
 */
export function areaLayers(zone: GameZone, current: ZoneCircle | null = null, next: ZoneCircle | null = null): {
  outline: FC;
  mask: FC;
  forbidden: FC;
  next: FC;
} {
  const ring = current
    ? circleRing(current, current.radius_m, 128)
    : zone.shape === "polygon" && zone.polygon.length >= 3
      ? closed(zone.polygon)
      : circleRing(zone, zone.radius_m, 128);
  const forbidden = (zone.forbidden ?? []).map((f) =>
    polygon(f.kind === "polygon" ? closed(f.points) : circleRing(f, f.radius_m, 64), { label: f.label }),
  );
  return {
    outline: fc([line(ring)]),
    mask: fc([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [WORLD, [...ring].reverse()] } }]),
    forbidden: fc(forbidden),
    next: next ? fc([line(circleRing(next, next.radius_m, 128))]) : EMPTY_FC,
  };
}

/** Balises (prises : grisées) et point d'extraction (actif seulement une fois ouvert). */
export function objectiveLayers(objectives: Objective[], extractionOpen: boolean): FC {
  return fc(
    objectives.map((o) =>
      point(o, {
        kind: o.kind,
        label: o.kind === "extraction" ? `${o.label}${extractionOpen ? "" : " (fermée)"}` : o.label,
        color: o.kind === "extraction" ? (extractionOpen ? MAP_COLORS.fugitive : MAP_COLORS.stale) : o.claimed_by ? MAP_COLORS.stale : MAP_COLORS.warn,
        claimed: !!o.claimed_by,
      }),
    ),
  );
}

export function objectiveRings(objectives: Objective[]): FC {
  return fc(objectives.filter((o) => !o.claimed_by).map((o) => line(circleRing(o, o.radius_m, 32))));
}

const MARKER_COLOR: Record<TeamMarker["kind"], string> = {
  enemy: MAP_COLORS.hunter, danger: MAP_COLORS.warn, meet: MAP_COLORS.fugitive, objective: MAP_COLORS.volt, info: MAP_COLORS.ivory,
};
export function markerLayers(markers: TeamMarker[], now: number): FC {
  return fc(markers.filter((m) => m.expires_at > now).map((m) => point(m, { kind: m.kind, color: MARKER_COLOR[m.kind] })));
}

/** Dernière révélation de Mister X (Chasseurs), estompée avec l'âge. */
export function misterXLayer(s: GameState, now: number): FC {
  const last = s.ext.misterx?.last;
  if (!last || last.lat == null || last.lng == null || s.me.team !== "hunter") return EMPTY_FC;
  const age = now - last.at;
  return fc([point({ lat: last.lat, lng: last.lng }, { color: MAP_COLORS.fugitive, opacity: Math.max(0.35, 1 - age / 300_000) })]);
}
