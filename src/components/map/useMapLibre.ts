"use client";
/**
 * Création d'une carte MapLibre avec le fournisseur et le style configurés.
 * Le composant appelant ajoute ses propres couches via `map` une fois prêt.
 * Aucune géolocalisation : le contrôle de position GPS n'est jamais ajouté.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import { useEffect, useState, type RefObject } from "react";
import { getProvider } from "@/lib/map/provider";
import { resolveStyle } from "@/lib/map/style";
import type { LngLat } from "@/lib/map/geo";

let workerConfigured = false;
function configureWorker() {
  if (workerConfigured) return;
  workerConfigured = true;
  maplibregl.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibregl.getVersion()}.mjs`);
}

export interface MapInit {
  center: LngLat;
  zoom?: number;
  bounds?: [LngLat, LngLat];
  maxBounds?: [LngLat, LngLat];
}

export type MapStatus = "loading" | "ready" | "error";

export function useMapLibre(container: RefObject<HTMLDivElement | null>, init: MapInit) {
  const [map, setMap] = useState<MLMap | null>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [initial] = useState(init);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    configureWorker();
    const provider = getProvider();
    let m: MLMap;
    try {
      m = new maplibregl.Map({
        container: el,
        style: resolveStyle(provider),
        center: initial.center,
        zoom: initial.zoom ?? 15,
        bounds: initial.bounds,
        fitBoundsOptions: { padding: 24 },
        maxBounds: initial.maxBounds,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 0,
        fadeDuration: 150,
      });
    } catch (e) {
      // WebGL indisponible (très vieux appareil, navigateur restreint).
      setError((e as Error).message);
      setStatus("error");
      return;
    }
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    const onLoad = () => {
      setMap(m);
      setStatus("ready");
    };
    const onError = (ev: { error?: { message?: string } }) => {
      // Une tuile manquante ne doit pas bloquer le jeu : on signale seulement
      // les erreurs survenant avant le premier chargement.
      if (!m.loaded()) {
        setError(ev.error?.message ?? "Carte indisponible");
      }
    };
    m.on("load", onLoad);
    m.on("error", onError);
    return () => {
      m.remove();
      setMap(null);
      setStatus("loading");
    };
  }, [container, initial]);

  return { map, status, error };
}
