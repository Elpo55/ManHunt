/**
 * Replay d'une partie : trajets reconstruits (positions arrondies à 10 m,
 * 1 point / 10 s), disponibles 24 h après la partie pour ses seuls
 * participants, puis effacés par le serveur.
 */
import { Camera, GeoJSONSource, Layer, Map, type StyleSpecification } from "@maplibre/maplibre-react-native";
import { MAP_COLORS, areaLayers, buildDarkStyle, formatClock, toAppError, zoneBounds, type FC } from "@traque/shared";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Guard } from "../../../components/Guard";
import { Button, Loading, Notice, Panel, Screen, T } from "../../../components/ui";
import { api, type ReplayData } from "../../../lib/api";
import { mapProvider } from "../../../lib/env";
import { colors, space } from "../../../theme";

const mapStyle = (mapProvider.styleUrl ?? buildDarkStyle(mapProvider)) as string | StyleSpecification;
const EVENT_LABEL: Record<string, string> = {
  capture: "Capture",
  objective_claimed: "Balise atteinte",
  extracted: "Exfiltration",
  zone_shrink: "Réduction de zone",
  sos: "SOS",
  game_finished: "Fin de partie",
};

export default function Replay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [barWidth, setBarWidth] = useState(1);
  const speed = useRef(30); // 30 s de partie par seconde réelle

  useEffect(() => {
    if (!id) return;
    api
      .replay(id)
      .then((d) => {
        setData(d);
        setT(d.started_at);
      })
      .catch((e) => setError(toAppError(e).message));
  }, [id]);

  useEffect(() => {
    if (!playing || !data) return;
    const h = setInterval(() => {
      setT((cur) => {
        const next = cur + speed.current * 250;
        if (next >= data.ended_at) {
          setPlaying(false);
          return data.ended_at;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(h);
  }, [playing, data]);

  const area = useMemo(() => (data ? areaLayers(data.zone) : null), [data]);
  const layers = useMemo(() => {
    if (!data) return null;
    const lines: FC["features"] = [];
    const heads: FC["features"] = [];
    for (const tr of data.tracks) {
      const pts = tr.points.filter((p) => p.t <= t);
      const color = tr.team === "hunter" ? MAP_COLORS.hunter : MAP_COLORS.fugitive;
      if (pts.length >= 2) lines.push({ type: "Feature", properties: { color }, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) } });
      const last = pts[pts.length - 1];
      if (last) heads.push({ type: "Feature", properties: { color, label: tr.username }, geometry: { type: "Point", coordinates: [last.lng, last.lat] } });
    }
    return { lines: { type: "FeatureCollection", features: lines } as FC, heads: { type: "FeatureCollection", features: heads } as FC };
  }, [data, t]);

  if (error) return <Screen><Notice tone="error">{error}</Notice></Screen>;
  if (!data || !area || !layers) return <Loading label="Chargement du replay" />;
  const span = Math.max(1, data.ended_at - data.started_at);
  const b = zoneBounds(data.zone, data.zone.radius_m, 0.1);
  const seek = (x: number) => setT(data.started_at + Math.min(1, Math.max(0, x / barWidth)) * span);
  const visibleEvents = data.events.filter((e) => EVENT_LABEL[e.t] && e.at <= t).slice(-4).reverse();

  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Replay" }} />
        <View style={styles.map}>
          <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle} attribution logo={false} compass={false} touchRotate={false} touchPitch={false}>
            <Camera initialViewState={{ bounds: [b.sw[0], b.sw[1], b.ne[0], b.ne[1]] }} />
            <GeoJSONSource id="rp-zone" data={area.outline}>
              <Layer id="rp-zone" type="line" paint={{ "line-color": MAP_COLORS.ivory, "line-opacity": 0.5, "line-width": 1.5 }} />
            </GeoJSONSource>
            <GeoJSONSource id="rp-forbidden" data={area.forbidden}>
              <Layer id="rp-forbidden" type="fill" paint={{ "fill-color": MAP_COLORS.hunter, "fill-opacity": 0.2 }} />
            </GeoJSONSource>
            <GeoJSONSource id="rp-lines" data={layers.lines}>
              <Layer id="rp-lines" type="line" paint={{ "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.75 }} />
            </GeoJSONSource>
            <GeoJSONSource id="rp-heads" data={layers.heads}>
              <Layer id="rp-heads" type="circle" paint={{ "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 }} />
            </GeoJSONSource>
          </Map>
        </View>
        <Panel>
          <T v="num" style={{ textAlign: "center" }}>{formatClock(t - data.started_at)} / {formatClock(span)}</T>
          <View
            style={styles.bar}
            onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(e) => seek(e.nativeEvent.locationX)}
            onResponderMove={(e) => seek(e.nativeEvent.locationX)}
            accessibilityRole="adjustable"
            accessibilityLabel="Position dans la partie"
          >
            <View style={[styles.fill, { width: `${((t - data.started_at) / span) * 100}%` }]} />
            {data.events
              .filter((e) => e.t === "capture" || e.t === "objective_claimed" || e.t === "zone_shrink")
              .map((e, i) => (
                <View key={i} style={[styles.tick, { left: `${Math.min(100, Math.max(0, ((e.at - data.started_at) / span) * 100))}%`, backgroundColor: e.t === "capture" ? colors.hunter : colors.warn }]} />
              ))}
          </View>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="−30 s" small variant="secondary" style={{ flex: 1 }} onPress={() => setT(Math.max(data.started_at, t - 30_000))} />
            <Button
              label={playing ? "Pause" : t >= data.ended_at ? "Revoir" : "Lecture"}
              small
              icon={playing ? "pause" : "play"}
              style={{ flex: 2 }}
              onPress={() => {
                if (!playing && t >= data.ended_at) setT(data.started_at);
                setPlaying((p) => !p);
              }}
            />
            <Button label="+30 s" small variant="secondary" style={{ flex: 1 }} onPress={() => setT(Math.min(data.ended_at, t + 30_000))} />
          </View>
          {visibleEvents.map((e, i) => (
            <T key={i} v="small" color={colors.ivory}>{formatClock(e.at - data.started_at)} · {EVENT_LABEL[e.t]}</T>
          ))}
        </Panel>
        <T v="caption">Trajets arrondis à 10 m, disponibles 24 h après la partie puis effacés. Un joueur ayant utilisé l’arrêt de sécurité n’a pas de trajet.</T>
      </Screen>
    </Guard>
  );
}

const styles = StyleSheet.create({
  map: { height: 380, borderRadius: 14, overflow: "hidden", backgroundColor: colors.abyss },
  bar: { height: 28, borderRadius: 14, backgroundColor: colors.slate, overflow: "hidden", justifyContent: "center" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.voltSoft },
  tick: { position: "absolute", width: 2, top: 4, bottom: 4 },
});
