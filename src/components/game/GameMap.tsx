"use client";
/**
 * Carte tactique sur fond OpenStreetMap réel (MapLibre).
 *
 * Interface identique à l'ancienne carte canvas : la page de jeu, le
 * contrôleur et le multijoueur ne changent pas. Les positions affichées sont
 * les cases virtuelles du serveur converties en coordonnées géographiques ;
 * toucher la carte désigne une case (déplacement ou ciblage).
 */
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { cellLabel } from "@/lib/engine/grid";
import type { Cell } from "@/lib/engine/types";
import type { GameState } from "@/lib/game/state";
import { cellCenter, geoOf, lngLatToCell, zoneBounds } from "@/lib/map/geo";
import {
  EMPTY_FC,
  GAME_COLORS,
  cellsLayer,
  effectsLayer,
  fogLayer,
  forbiddenLayer,
  pathLayer,
  playersLayer,
  radarLayers,
  revealLayer,
  sweepRing,
  targetLayer,
  trailsLayer,
  visionRing,
  zoneLayers,
  type FC,
} from "@/lib/map/layers";
import { useMapLibre } from "../map/useMapLibre";

export interface MapHandle {
  recenter: () => void;
  zoom: (factor: number) => void;
}

export interface GameMapProps {
  state: GameState;
  now: number;
  reachable: Set<string> | null;
  path: Cell[] | null;
  target: { range: number; radius?: number } | null;
  hover: Cell | null;
  showCoordinates: boolean;
  onCellTap: (c: Cell) => void;
  /** Trajets à afficher (par défaut ceux reçus pendant la partie) */
  trails?: Record<string, Cell[]>;
  /** Carte de consultation (résultats) */
  readonly?: boolean;
}

const SOURCES = [
  "zone-mask", "zone-outline", "forbidden", "fog", "reach", "effects", "radar-areas", "bearings",
  "reveals", "vision", "sweep", "trails", "path", "target", "players",
] as const;
type SourceId = (typeof SOURCES)[number];

function installLayers(map: MLMap) {
  for (const id of SOURCES) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY_FC });
  }
  const add = (layer: Parameters<MLMap["addLayer"]>[0]) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  };
  // Hors zone : assombri. Contour de zone : fin et discret.
  add({ id: "zone-mask", type: "fill", source: "zone-mask", paint: { "fill-color": GAME_COLORS.fog, "fill-opacity": 0.72 } });
  add({ id: "zone-outline", type: "line", source: "zone-outline", paint: { "line-color": GAME_COLORS.ivory, "line-opacity": 0.35, "line-width": 1.2 } });
  add({ id: "forbidden-fill", type: "fill", source: "forbidden", paint: { "fill-color": GAME_COLORS.hunter, "fill-opacity": 0.1 } });
  add({ id: "forbidden-line", type: "line", source: "forbidden", paint: { "line-color": GAME_COLORS.hunter, "line-opacity": 0.45, "line-width": 1, "line-dasharray": [2, 2] } });
  add({ id: "fog", type: "fill", source: "fog", paint: { "fill-color": GAME_COLORS.fog, "fill-opacity": 0.58, "fill-antialias": false } });
  add({ id: "reach", type: "fill", source: "reach", paint: { "fill-color": GAME_COLORS.volt, "fill-opacity": 0.12, "fill-antialias": false } });
  add({ id: "effects-fill", type: "fill", source: "effects", paint: { "fill-color": GAME_COLORS.warn, "fill-opacity": 0.18 } });
  add({ id: "effects-line", type: "line", source: "effects", paint: { "line-color": GAME_COLORS.warn, "line-width": 1.5 } });
  add({
    id: "radar-areas-fill",
    type: "fill",
    source: "radar-areas",
    paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", 0.12, ["get", "opacity"]] },
  });
  add({
    id: "radar-areas-line",
    type: "line",
    source: "radar-areas",
    paint: { "line-color": ["get", "color"], "line-opacity": ["*", 0.75, ["get", "opacity"]], "line-width": 1.4, "line-dasharray": [3, 2] },
  });
  add({
    id: "bearings",
    type: "line",
    source: "bearings",
    layout: { "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-opacity": ["get", "opacity"], "line-width": 2, "line-dasharray": [2, 2] },
  });
  add({ id: "reveals", type: "line", source: "reveals", paint: { "line-color": GAME_COLORS.volt, "line-opacity": 0.7, "line-width": 1.5 } });
  add({ id: "vision", type: "line", source: "vision", paint: { "line-color": GAME_COLORS.ivory, "line-opacity": 0.16, "line-width": 1, "line-dasharray": [1, 2] } });
  add({ id: "sweep", type: "line", source: "sweep", paint: { "line-color": GAME_COLORS.volt, "line-opacity": 0, "line-width": 2, "line-blur": 1 } });
  add({
    id: "trails",
    type: "line",
    source: "trails",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-opacity": 0.35, "line-width": 2 },
  });
  add({ id: "path-line", type: "line", source: "path", filter: ["==", ["get", "role"], "line"], paint: { "line-color": GAME_COLORS.volt, "line-width": 2.5, "line-dasharray": [1.5, 1.5] } });
  add({ id: "path-end", type: "line", source: "path", filter: ["==", ["get", "role"], "end"], paint: { "line-color": GAME_COLORS.volt, "line-width": 2 } });
  add({ id: "target-range", type: "line", source: "target", filter: ["==", ["get", "role"], "range"], paint: { "line-color": GAME_COLORS.warn, "line-opacity": 0.6, "line-width": 1.2, "line-dasharray": [2, 2] } });
  add({ id: "target-area", type: "fill", source: "target", filter: ["==", ["get", "role"], "area"], paint: { "fill-color": GAME_COLORS.warn, "fill-opacity": 0.15 } });
  // Joueurs : halo pour moi, disque coloré, anneau pour les contacts révélés.
  add({
    id: "players-halo",
    type: "circle",
    source: "players",
    filter: ["==", ["get", "kind"], "me"],
    paint: { "circle-radius": 16, "circle-color": GAME_COLORS.volt, "circle-opacity": 0.16 },
  });
  add({
    id: "players",
    type: "circle",
    source: "players",
    filter: ["!=", ["get", "kind"], "revealed"],
    paint: {
      "circle-radius": ["match", ["get", "kind"], "me", 8, 6.5],
      "circle-color": ["get", "color"],
      "circle-opacity": ["get", "opacity"],
      "circle-stroke-color": ["match", ["get", "kind"], "me", "#ffffff", "#050608"],
      "circle-stroke-width": ["match", ["get", "kind"], "me", 2.5, 1.5],
      "circle-stroke-opacity": ["get", "opacity"],
    },
  });
  add({
    id: "players-revealed",
    type: "circle",
    source: "players",
    filter: ["==", ["get", "kind"], "revealed"],
    paint: { "circle-radius": 7, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 },
  });
  add({
    id: "players-label",
    type: "symbol",
    source: "players",
    minzoom: 15.5,
    filter: ["all", ["!=", ["get", "label"], ""], ["!=", ["get", "kind"], "me"]],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-offset": [0, 1.3],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: { "text-color": GAME_COLORS.ivory, "text-opacity": 0.8, "text-halo-color": "#0b0d11", "text-halo-width": 1.2 },
  });
}

function setData(map: MLMap, id: SourceId, data: FC) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

export const GameMap = forwardRef<MapHandle, GameMapProps>(function GameMap(props, ref) {
  const { state, now } = props;
  const container = useRef<HTMLDivElement>(null);
  const geo = geoOf(state.game.map);
  const { map, status, error } = useMapLibre(container, {
    center: [geo.lng, geo.lat],
    bounds: zoneBounds(geo, 0.05),
    maxBounds: zoneBounds(geo, 1.5),
  });
  const tapRef = useRef(props.onCellTap);
  useEffect(() => {
    tapRef.current = props.onCellTap;
  });
  const lastPulse = useRef<number | null>(state.radar?.i ?? null);

  // Couches statiques (zone, zones interdites) une fois la carte prête.
  const zone = useMemo(() => zoneLayers(state.game.map), [state.game.map]);
  const forbidden = useMemo(() => forbiddenLayer(state.game.map), [state.game.map]);
  useEffect(() => {
    if (!map) return;
    installLayers(map);
    setData(map, "zone-mask", zone.mask);
    setData(map, "zone-outline", zone.outline);
    setData(map, "forbidden", forbidden);
  }, [map, zone, forbidden]);

  // Couches dynamiques.
  const fog = useMemo(() => fogLayer(state), [state]);
  const players = useMemo(() => playersLayer(state, now), [state, now]);
  const radar = useMemo(() => radarLayers(state, now), [state, now]);
  const { readonly, trails, path, target, hover, reachable } = props;
  useEffect(() => {
    if (!map) return;
    setData(map, "fog", fog);
    setData(map, "players", players);
    setData(map, "radar-areas", radar.areas);
    setData(map, "bearings", radar.bearings);
    setData(map, "effects", effectsLayer(state, now));
    setData(map, "reveals", revealLayer(state, now));
    setData(map, "vision", readonly ? EMPTY_FC : visionRing(state));
    setData(map, "trails", trailsLayer(state, trails ?? state.trails));
    setData(map, "path", pathLayer(state, path));
    setData(map, "target", targetLayer(state, target, hover));
    setData(map, "reach", reachable ? cellsLayer(state.game.map, reachable) : EMPTY_FC);
  }, [map, state, now, fog, players, radar, readonly, trails, path, target, hover, reachable]);

  // Toucher / cliquer une case.
  useEffect(() => {
    if (!map) return;
    const m = state.game.map;
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
      const c = lngLatToCell(m, [e.lngLat.lng, e.lngLat.lat]);
      if (c.x >= 0 && c.y >= 0 && c.x < m.w && c.y < m.h) tapRef.current(c);
    };
    map.on("click", onClick);
    map.getCanvas().style.cursor = readonly ? "" : "crosshair";
    return () => {
      map.off("click", onClick);
    };
  }, [map, state.game.map, readonly]);

  // Impulsion radar : un anneau qui s'étend sur la zone (seule animation continue).
  useEffect(() => {
    const r = state.radar;
    if (!map || !r || r.i === lastPulse.current) return;
    lastPulse.current = r.i;
    if (document.documentElement.dataset.reducedMotion === "true" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const origin = cellCenter(state.game.map, r.origin.x, r.origin.y);
    const maxR = geo.radius_m * 1.6;
    const start = performance.now();
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 1600);
      const eased = 1 - Math.pow(1 - t, 3);
      setData(map, "sweep", sweepRing(origin, maxR * (0.04 + 0.96 * eased)));
      map.setPaintProperty("sweep", "line-opacity", 0.6 * (1 - t));
      if (t < 1) frame = requestAnimationFrame(step);
      else setData(map, "sweep", EMPTY_FC);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [map, state.radar, state.game.map, geo.radius_m]);

  const meX = state.me.x;
  const meY = state.me.y;
  useImperativeHandle(ref, () => ({
    recenter: () => {
      if (!map) return;
      map.easeTo({ center: cellCenter(state.game.map, meX, meY), zoom: Math.max(map.getZoom(), 16), duration: 500 });
    },
    zoom: (f: number) => {
      if (map) map.easeTo({ zoom: map.getZoom() + Math.log2(f), duration: 250 });
    },
  }));

  return (
    <div className="absolute inset-0">
      <div
        ref={container}
        className="absolute inset-0"
        role="application"
        aria-label={`Carte de jeu${props.showCoordinates ? `, votre case ${cellLabel(state.me.x, state.me.y)}` : ""}`}
      />
      {status !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-abyss">
          <p className="max-w-xs px-6 text-center text-sm text-fog">
            {status === "error" || error
              ? `Carte indisponible : ${error ?? "WebGL non pris en charge"}. Le jeu reste synchronisé ; rechargez la page.`
              : "Chargement de la carte…"}
          </p>
        </div>
      ) : null}
    </div>
  );
});
