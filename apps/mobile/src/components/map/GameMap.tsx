/**
 * Carte de jeu plein écran (MapLibre natif, données OpenStreetMap).
 * N'affiche que ce que le serveur a autorisé : coéquipiers (~10 m),
 * adversaires approximatifs, contacts radar, révélations. Les positions
 * obsolètes sont grisées, jamais animées.
 */
import { Camera, GeoJSONSource, Layer, Map, type CameraRef, type StyleSpecification } from "@maplibre/maplibre-react-native";
import {
  MAP_COLORS,
  buildDarkStyle,
  captureRing,
  myDisplayPosition,
  playerLayers,
  radarLayers,
  sweepRing,
  zoneBounds,
  zoneLayers,
  EMPTY_FC,
  type GameState,
} from "@traque/shared";
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { T } from "../ui";
import { mapProvider } from "../../lib/env";
import { colors } from "../../theme";

export interface GameMapHandle {
  recenter: () => void;
  showZone: () => void;
}

const mapStyle = (mapProvider.styleUrl ?? buildDarkStyle(mapProvider)) as string | StyleSpecification;

/**
 * `now` doit être arrondi par l'appelant (1 s) : la carte n'est alors
 * redessinée qu'à 1 Hz au plus, ou quand l'état change (memo).
 */
export const GameMap = memo(forwardRef<GameMapHandle, { state: GameState; now: number }>(function GameMap({ state, now }, ref) {
  const camera = useRef<CameraRef>(null);
  const zone = state.game.zone;
  const [failed, setFailed] = useState(false);
  const bounds = useMemo(() => zoneBounds(zone, zone.radius_m, 0.08), [zone]);
  const initialView = useMemo(() => ({ bounds: [bounds.sw[0], bounds.sw[1], bounds.ne[0], bounds.ne[1]] as [number, number, number, number] }), [bounds]);
  const maxBounds = useMemo(() => {
    const b = zoneBounds(zone, zone.radius_m, 2);
    return [b.sw[0], b.sw[1], b.ne[0], b.ne[1]] as [number, number, number, number];
  }, [zone]);
  const zl = useMemo(() => zoneLayers(zone), [zone]);
  const players = useMemo(() => playerLayers(state, now), [state, now]);
  const radar = useMemo(() => radarLayers(state, now), [state, now]);
  const ring = useMemo(() => captureRing(state), [state]);
  const [sweep, setSweep] = useState<{ r: number; o: number } | null>(null);
  const lastPulse = useRef<number | null>(state.radar?.i ?? null);

  // Impulsion radar : un anneau qui s'étend (désactivé si « réduire les animations »).
  useEffect(() => {
    const r = state.radar;
    if (!r || r.i === lastPulse.current || !r.origin) return;
    lastPulse.current = r.i;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      const start = Date.now();
      timer = setInterval(() => {
        const t = Math.min(1, (Date.now() - start) / 1600);
        setSweep(t < 1 ? { r: zone.radius_m * 1.4 * (1 - Math.pow(1 - t, 3)), o: 0.6 * (1 - t) } : null);
        if (t >= 1 && timer) clearInterval(timer);
      }, 70);
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [state.radar, zone.radius_m]);

  useImperativeHandle(ref, () => ({
    recenter: () => {
      const me = myDisplayPosition(state);
      if (me) camera.current?.easeTo({ center: [me.lng, me.lat], zoom: 16.5, duration: 500 });
    },
    showZone: () => camera.current?.fitBounds([bounds.sw[0], bounds.sw[1], bounds.ne[0], bounds.ne[1]], { duration: 500, padding: { top: 120, bottom: 220, left: 24, right: 24 } }),
  }));

  const sweepData = sweep && state.radar?.origin ? sweepRing(state.radar.origin, sweep.r) : EMPTY_FC;

  return (
    <View style={StyleSheet.absoluteFill} accessibilityLabel="Carte de la partie" accessible={false}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyle}
        attribution
        attributionPosition={ATTRIBUTION_POSITION}
        onDidFailLoadingMap={() => setFailed(true)}
        onDidFinishLoadingMap={() => setFailed(false)}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        scaleBar={false}
      >
        <Camera
          ref={camera}
          initialViewState={initialView}
          maxBounds={maxBounds}
          minZoom={11}
          maxZoom={19}
        />

        <GeoJSONSource id="zone-mask" data={zl.mask}>
          <Layer id="zone-mask" type="fill" paint={{ "fill-color": MAP_COLORS.abyss, "fill-opacity": 0.62 }} />
        </GeoJSONSource>
        <GeoJSONSource id="zone-outline" data={zl.outline}>
          <Layer id="zone-outline" type="line" paint={{ "line-color": MAP_COLORS.ivory, "line-opacity": 0.4, "line-width": 1.5 }} />
        </GeoJSONSource>

        <GeoJSONSource id="radar-areas" data={radar.areas}>
          <Layer id="radar-areas-fill" type="fill" paint={{ "fill-color": ["get", "color"], "fill-opacity": ["*", 0.14, ["get", "opacity"]] }} />
          <Layer
            id="radar-areas-line"
            type="line"
            paint={{ "line-color": ["get", "color"], "line-opacity": ["*", 0.8, ["get", "opacity"]], "line-width": 1.5, "line-dasharray": [3, 2] }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="bearings" data={radar.bearings}>
          <Layer
            id="bearings"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{ "line-color": ["get", "color"], "line-opacity": ["get", "opacity"], "line-width": 2.5, "line-dasharray": [2, 2] }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="sweep" data={sweepData}>
          <Layer id="sweep" type="line" paint={{ "line-color": MAP_COLORS.volt, "line-opacity": sweep?.o ?? 0, "line-width": 2 }} />
        </GeoJSONSource>
        <GeoJSONSource id="capture-ring" data={ring}>
          <Layer id="capture-ring" type="line" paint={{ "line-color": MAP_COLORS.hunter, "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [1, 2] }} />
        </GeoJSONSource>

        <GeoJSONSource id="accuracy" data={players.accuracy}>
          <Layer id="accuracy-fill" type="fill" paint={{ "fill-color": ["get", "color"], "fill-opacity": 0.08 }} />
          <Layer id="accuracy-line" type="line" paint={{ "line-color": ["get", "color"], "line-opacity": 0.3, "line-width": 1 }} />
        </GeoJSONSource>
        <GeoJSONSource id="players" data={players.points}>
          <Layer
            id="me-halo"
            type="circle"
            filter={["==", ["get", "kind"], "me"]}
            paint={{ "circle-radius": 18, "circle-color": ["get", "color"], "circle-opacity": 0.18 }}
          />
          <Layer
            id="players"
            type="circle"
            filter={["!=", ["get", "kind"], "revealed"]}
            paint={{
              "circle-radius": ["case", ["==", ["get", "kind"], "me"], 8, ["get", "stale"], 5, 7],
              "circle-color": ["get", "color"],
              "circle-stroke-color": ["case", ["==", ["get", "kind"], "me"], "#ffffff", MAP_COLORS.abyss],
              "circle-stroke-width": ["case", ["==", ["get", "kind"], "me"], 2.5, 1.5],
              "circle-opacity": ["case", ["get", "stale"], 0.55, 1],
            }}
          />
          <Layer
            id="players-revealed"
            type="circle"
            filter={["==", ["get", "kind"], "revealed"]}
            paint={{ "circle-radius": 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 }}
          />
          <Layer
            id="players-label"
            type="symbol"
            minzoom={15}
            filter={["all", ["!=", ["get", "label"], ""], ["!=", ["get", "kind"], "me"]]}
            layout={{
              "text-field": ["get", "label"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 12,
              "text-offset": [0, 1.4],
              "text-anchor": "top",
              "text-optional": true,
            }}
            paint={{ "text-color": colors.ivory, "text-opacity": 0.85, "text-halo-color": "#0b0d11", "text-halo-width": 1.2 }}
          />
        </GeoJSONSource>
      </Map>
      {failed ? (
        <View style={styles.failed} pointerEvents="none">
          <T v="small" color={colors.ivory}>Fond de carte indisponible (réseau ou serveur de tuiles). Les joueurs, la zone et le radar restent affichés.</T>
        </View>
      ) : null}
    </View>
  );
}));

const ATTRIBUTION_POSITION = { bottom: 8, left: 8 };
const styles = StyleSheet.create({
  failed: { position: "absolute", left: 16, right: 16, top: "38%", backgroundColor: "rgba(16,19,25,0.94)", borderRadius: 12, padding: 12 },
});
