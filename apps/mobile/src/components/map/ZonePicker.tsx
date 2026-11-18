/**
 * Choix de la zone de jeu par l'hôte, sur la carte réelle :
 * recherche d'un lieu (OSM), déplacement libre (le centre suit le réticule),
 * réglage du rayon. La position de l'hôte n'est jamais utilisée sans action
 * explicite (« Centrer sur ma position »).
 */
import { Camera, GeoJSONSource, Layer, Map, type CameraRef, type StyleSpecification } from "@maplibre/maplibre-react-native";
import { BOUNDS, MAP_COLORS, buildDarkStyle, circleRing, createGeocoder, formatMeters, zoneBounds, type GameZone, type Place } from "@traque/shared";
import * as Location from "expo-location";
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GEOCODER_URL, USER_AGENT, mapProvider } from "../../lib/env";
import { colors, space } from "../../theme";
import { Button, Input, Notice, Stepper, T } from "../ui";

const mapStyle = (mapProvider.styleUrl ?? buildDarkStyle(mapProvider)) as string | StyleSpecification;
const searchPlaces = createGeocoder({ url: GEOCODER_URL, userAgent: USER_AGENT });

export function ZonePicker({ value, onChange, disabled }: { value: GameZone; onChange: (z: GameZone) => void; disabled?: boolean }) {
  const camera = useRef<CameraRef>(null);
  const [center, setCenter] = useState<[number, number]>([value.lng, value.lat]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo(() => zoneBounds(value, value.radius_m, 0.3), []); // eslint-disable-line react-hooks/exhaustive-deps

  const circle = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: [{ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [circleRing({ lng: center[0], lat: center[1] }, value.radius_m, 96)] } }],
    }),
    [center, value.radius_m],
  );

  const commit = (lng: number, lat: number, label?: string) =>
    onChange({ ...value, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), label: (label ?? value.label).slice(0, 80), set: true });

  async function search() {
    setBusy(true);
    setError(null);
    try {
      setResults(await searchPlaces(query));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function choose(p: Place) {
    setResults(null);
    setCenter([p.lng, p.lat]);
    commit(p.lng, p.lat, p.label);
    const b = zoneBounds(p, value.radius_m, 0.3);
    camera.current?.fitBounds([b.sw[0], b.sw[1], b.ne[0], b.ne[1]], { duration: 600 });
  }

  async function centerOnMe() {
    setError(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return setError("Autorisation de localisation refusée : utilisez la recherche ou déplacez la carte.");
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setCenter([pos.coords.longitude, pos.coords.latitude]);
    commit(pos.coords.longitude, pos.coords.latitude, "Autour de ma position");
    camera.current?.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15, duration: 600 });
  }

  return (
    <View style={{ gap: space.md }}>
      {!disabled ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Input
            style={{ flex: 1 }}
            placeholder="Parc, quartier, ville…"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={search}
            accessibilityLabel="Rechercher un lieu"
          />
          <Button label="Chercher" small variant="secondary" icon="search" onPress={search} loading={busy} disabled={query.trim().length < 3} />
        </View>
      ) : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {results ? (
        <View style={{ backgroundColor: colors.slate, borderRadius: 12, overflow: "hidden" }}>
          {results.length === 0 ? (
            <T v="small" style={{ padding: space.md }}>Aucun lieu trouvé.</T>
          ) : (
            results.map((p) => (
              <Pressable key={`${p.lat},${p.lng}`} onPress={() => choose(p)} style={({ pressed }) => [{ padding: space.md }, pressed && { backgroundColor: colors.slate2 }]} accessibilityRole="button">
                <T v="small" color={colors.ivory}>{p.label}</T>
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      <View style={styles.mapBox}>
        <Map
          style={StyleSheet.absoluteFill}
          mapStyle={mapStyle}
          attribution
          logo={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
          dragPan={!disabled}
          touchZoom={!disabled}
          onRegionIsChanging={(e) => !disabled && setCenter(e.nativeEvent.center as [number, number])}
          onRegionDidChange={(e) => {
            if (disabled) return;
            const c = e.nativeEvent.center as [number, number];
            setCenter(c);
            if (Math.abs(c[0] - value.lng) > 1e-6 || Math.abs(c[1] - value.lat) > 1e-6) commit(c[0], c[1]);
          }}
        >
          <Camera ref={camera} initialViewState={{ bounds: [initial.sw[0], initial.sw[1], initial.ne[0], initial.ne[1]] }} />
          <GeoJSONSource id="zone" data={circle}>
            <Layer id="zone-fill" type="fill" paint={{ "fill-color": MAP_COLORS.volt, "fill-opacity": 0.1 }} />
            <Layer id="zone-line" type="line" paint={{ "line-color": MAP_COLORS.volt, "line-width": 1.5 }} />
          </GeoJSONSource>
        </Map>
        {!disabled ? <View pointerEvents="none" style={styles.crosshair}><View style={styles.crossH} /><View style={styles.crossV} /></View> : null}
      </View>
      {!disabled ? (
        <>
          <T v="small">Faites glisser la carte : le centre de la zone suit le réticule.</T>
          <Button label="Centrer sur ma position" small variant="ghost" icon="crosshair" onPress={centerOnMe} />
        </>
      ) : null}
      <Stepper
        label="Rayon de la zone"
        value={value.radius_m}
        min={BOUNDS.zone_radius_m.min}
        max={BOUNDS.zone_radius_m.max}
        step={50}
        format={formatMeters}
        disabled={disabled}
        onChange={(r) => onChange({ ...value, radius_m: r, set: true })}
        hint="Choisissez un espace public, sans grands axes à traverser."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mapBox: { height: 300, borderRadius: 14, overflow: "hidden", backgroundColor: colors.abyss },
  crosshair: { position: "absolute", left: "50%", top: "50%", width: 24, height: 24, marginLeft: -12, marginTop: -12, alignItems: "center", justifyContent: "center" },
  crossH: { position: "absolute", width: 24, height: 1.5, backgroundColor: colors.ivory },
  crossV: { position: "absolute", width: 1.5, height: 24, backgroundColor: colors.ivory },
});
