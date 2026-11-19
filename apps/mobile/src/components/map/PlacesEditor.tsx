/**
 * Éditeur des lieux d'une partie (hôte, avant le lancement) :
 * zone polygonale, zones interdites, balises, point d'extraction, rendez-vous.
 * Principe : faire glisser la carte sous le réticule, puis « Ajouter ici ».
 * Le serveur revalide tout au lancement (points dans l'aire de jeu, etc.).
 *
 * L'hôte choisit lui-même les points : ils doivent se trouver dans des lieux
 * publics, accessibles sans traverser de zone dangereuse ni de propriété privée.
 */
import { Camera, GeoJSONSource, Layer, Map, type CameraRef, type StyleSpecification } from "@maplibre/maplibre-react-native";
import {
  BOUNDS,
  MAP_COLORS,
  areaLayers,
  buildDarkStyle,
  distanceM,
  formatMeters,
  normalizeConfig,
  objectiveLayers,
  zoneBounds,
  type GameConfig,
  type LatLng,
  type Objective,
} from "@traque/shared";
import { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { mapProvider } from "../../lib/env";
import { colors, space } from "../../theme";
import { Button, Input, Notice, Segmented, Stepper, T } from "../ui";

type Tool = "polygon" | "forbidden" | "beacon" | "extraction" | "rendezvous";
const mapStyle = (mapProvider.styleUrl ?? buildDarkStyle(mapProvider)) as string | StyleSpecification;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Cercle englobant d'un polygone (cadrage de la carte, valeurs du serveur). */
function boundingCircle(points: LatLng[]): LatLng & { radius_m: number } {
  const lat = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const lng = points.reduce((a, p) => a + p.lng, 0) / points.length;
  const r = Math.max(...points.map((p) => distanceM({ lat, lng }, p)));
  return { lat: r6(lat), lng: r6(lng), radius_m: Math.min(BOUNDS.zone_radius_m.max, Math.max(BOUNDS.zone_radius_m.min, Math.ceil(r / 50) * 50)) };
}

export function PlacesEditor({ value, onChange, disabled }: { value: GameConfig; onChange: (c: GameConfig) => void; disabled?: boolean }) {
  const camera = useRef<CameraRef>(null);
  const [tool, setTool] = useState<Tool>("beacon");
  const [center, setCenter] = useState<LatLng>({ lat: value.zone.lat, lng: value.zone.lng });
  const [forbidRadius, setForbidRadius] = useState(50);
  const [rdvLabel, setRdvLabel] = useState(value.rendezvous.set ? value.rendezvous.label : "Point de rendez-vous");
  const initial = useMemo(() => zoneBounds(value.zone, value.zone.radius_m, 0.25), []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<GameConfig>) => onChange(normalizeConfig({ ...value, ...patch }));
  const z = value.zone;
  const ob = value.objectives;

  const area = useMemo(() => areaLayers(z), [z]);
  const objectives = useMemo<Objective[]>(
    () => [
      ...ob.beacons.map((b, i) => ({ idx: i + 1, kind: "beacon" as const, lat: b.lat, lng: b.lng, label: b.label, radius_m: ob.radius_m, claimed_by: null, claimed_at: null })),
      ...(ob.extraction.set ? [{ idx: 0, kind: "extraction" as const, lat: ob.extraction.lat, lng: ob.extraction.lng, label: ob.extraction.label, radius_m: ob.radius_m, claimed_by: null, claimed_at: null }] : []),
    ],
    [ob],
  );
  const extras = useMemo(() => {
    const feats = [
      ...objectiveLayers(objectives, true).features,
      ...(value.rendezvous.set
        ? [{ type: "Feature" as const, properties: { color: MAP_COLORS.ivory, label: value.rendezvous.label }, geometry: { type: "Point" as const, coordinates: [value.rendezvous.lng, value.rendezvous.lat] } }]
        : []),
    ];
    return { type: "FeatureCollection" as const, features: feats };
  }, [objectives, value.rendezvous]);
  const vertices = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: z.polygon.map((p, i) => ({ type: "Feature" as const, properties: { i }, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] } })),
    }),
    [z.polygon],
  );
  const [draft, setDraft] = useState<LatLng[]>([]);
  const draftFc = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: draft.map((p) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] } })),
    }),
    [draft],
  );

  const here: LatLng = { lat: r6(center.lat), lng: r6(center.lng) };
  const insideCircle = distanceM(z, here) <= z.radius_m;

  return (
    <View style={{ gap: space.md }}>
      <Segmented
        value={tool}
        disabled={disabled}
        onChange={setTool}
        options={[
          { value: "beacon", label: "Balises" },
          { value: "extraction", label: "Extraction" },
          { value: "rendezvous", label: "RDV" },
          { value: "forbidden", label: "Interdit" },
          { value: "polygon", label: "Forme" },
        ]}
      />
      <View style={styles.mapBox}>
        <Map
          style={StyleSheet.absoluteFill}
          mapStyle={mapStyle}
          attribution
          logo={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
          onRegionIsChanging={(e) => setCenter({ lng: e.nativeEvent.center[0], lat: e.nativeEvent.center[1] })}
          onRegionDidChange={(e) => setCenter({ lng: e.nativeEvent.center[0], lat: e.nativeEvent.center[1] })}
        >
          <Camera ref={camera} initialViewState={{ bounds: [initial.sw[0], initial.sw[1], initial.ne[0], initial.ne[1]] }} />
          <GeoJSONSource id="pe-outline" data={area.outline}>
            <Layer id="pe-outline" type="line" paint={{ "line-color": MAP_COLORS.volt, "line-width": 1.5 }} />
          </GeoJSONSource>
          <GeoJSONSource id="pe-forbidden" data={area.forbidden}>
            <Layer id="pe-forbidden" type="fill" paint={{ "fill-color": MAP_COLORS.hunter, "fill-opacity": 0.25 }} />
          </GeoJSONSource>
          <GeoJSONSource id="pe-vertices" data={vertices}>
            <Layer id="pe-vertices" type="circle" paint={{ "circle-radius": 4, "circle-color": MAP_COLORS.volt }} />
          </GeoJSONSource>
          <GeoJSONSource id="pe-draft" data={draftFc}>
            <Layer id="pe-draft" type="circle" paint={{ "circle-radius": 5, "circle-color": MAP_COLORS.warn }} />
          </GeoJSONSource>
          <GeoJSONSource id="pe-extras" data={extras}>
            <Layer id="pe-extras" type="circle" paint={{ "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 }} />
          </GeoJSONSource>
        </Map>
        <View pointerEvents="none" style={styles.crosshair}>
          <View style={styles.crossH} />
          <View style={styles.crossV} />
        </View>
      </View>
      {!insideCircle && tool !== "polygon" ? <Notice tone="warn">Le réticule est hors de la zone de jeu.</Notice> : null}

      {tool === "beacon" ? (
        <>
          <T v="small">Les Fugitifs gagnent des points en atteignant ces balises. Placez-les dans des lieux publics et accessibles (pas de propriété privée, pas de route à traverser).</T>
          <Button
            label={`Ajouter une balise ici (${ob.beacons.length}/10)`}
            icon="plus"
            small
            disabled={disabled || ob.beacons.length >= 10}
            onPress={() => set({ objectives: { ...ob, enabled: true, beacons: [...ob.beacons, { ...here, label: `Balise ${ob.beacons.length + 1}` }] } })}
          />
          {ob.beacons.map((b, i) => (
            <View key={`${b.lat},${b.lng}`} style={styles.row}>
              <T v="small" style={{ flex: 1 }} color={colors.ivory}>{b.label} · à {formatMeters(distanceM(z, b))} du centre</T>
              <Button label="Retirer" small variant="ghost" disabled={disabled} onPress={() => set({ objectives: { ...ob, beacons: ob.beacons.filter((_, j) => j !== i) } })} />
            </View>
          ))}
        </>
      ) : null}

      {tool === "extraction" ? (
        <>
          <T v="small">Le point d’extraction s’ouvre dans les dernières minutes : un Fugitif qui l’atteint est mis à l’abri et gagne un bonus.</T>
          <Button
            label={ob.extraction.set ? "Déplacer l'extraction ici" : "Placer l'extraction ici"}
            icon="flag"
            small
            disabled={disabled}
            onPress={() => set({ objectives: { ...ob, enabled: true, extraction: { set: true, ...here, label: ob.extraction.label } } })}
          />
          {ob.extraction.set ? (
            <Button label="Retirer l'extraction" small variant="ghost" disabled={disabled} onPress={() => set({ objectives: { ...ob, extraction: { ...ob.extraction, set: false } } })} />
          ) : null}
        </>
      ) : null}

      {tool === "rendezvous" ? (
        <>
          <T v="small">Lieu où tout le monde se retrouve après la partie. Affiché en permanence pendant le jeu.</T>
          <Input value={rdvLabel} onChangeText={setRdvLabel} maxLength={40} placeholder="Ex. entrée du parc" />
          <Button
            label={value.rendezvous.set ? "Déplacer le rendez-vous ici" : "Placer le rendez-vous ici"}
            icon="map-pin"
            small
            disabled={disabled}
            onPress={() => set({ rendezvous: { set: true, ...here, label: rdvLabel.trim() || "Point de rendez-vous" } })}
          />
          {value.rendezvous.set ? (
            <Button label="Retirer le rendez-vous" small variant="ghost" disabled={disabled} onPress={() => set({ rendezvous: { ...value.rendezvous, set: false } })} />
          ) : null}
        </>
      ) : null}

      {tool === "forbidden" ? (
        <>
          <T v="small">À l’intérieur d’une zone interdite (route, plan d’eau, chantier…), le joueur est « hors zone ». Dessinez-les vous-même : l’exclusion automatique des routes n’est pas disponible.</T>
          <Stepper label="Rayon" value={forbidRadius} min={BOUNDS.forbidden_radius_m.min} max={300} step={10} format={formatMeters} disabled={disabled} onChange={setForbidRadius} />
          <Button
            label={`Ajouter une zone interdite ici (${z.forbidden.length}/10)`}
            icon="slash"
            small
            disabled={disabled || z.forbidden.length >= 10}
            onPress={() => set({ zone: { ...z, forbidden: [...z.forbidden, { kind: "circle", ...here, radius_m: forbidRadius, label: `Zone interdite ${z.forbidden.length + 1}` }] } })}
          />
          {z.forbidden.map((f, i) => (
            <View key={`${f.label}:${i}`} style={styles.row}>
              <T v="small" style={{ flex: 1 }} color={colors.ivory}>{f.label}{f.kind === "circle" ? ` · ${formatMeters(f.radius_m)}` : ""}</T>
              <Button label="Retirer" small variant="ghost" disabled={disabled} onPress={() => set({ zone: { ...z, forbidden: z.forbidden.filter((_, j) => j !== i) } })} />
            </View>
          ))}
        </>
      ) : null}

      {tool === "polygon" ? (
        <>
          <T v="small">
            {z.shape === "polygon"
              ? `Zone polygonale (${z.polygon.length} sommets). Le mode Royale exige une zone circulaire.`
              : "Pour suivre les limites réelles d'un parc : ajoutez au moins 3 sommets dans l'ordre du contour, puis validez."}
          </T>
          <Button label={`Ajouter un sommet ici (${draft.length})`} icon="plus" small disabled={disabled || draft.length >= 20} onPress={() => setDraft([...draft, here])} />
          {draft.length ? <Button label="Retirer le dernier sommet" small variant="ghost" onPress={() => setDraft(draft.slice(0, -1))} /> : null}
          <Button
            label="Valider la forme"
            small
            disabled={disabled || draft.length < 3}
            onPress={() => {
              const bc = boundingCircle(draft);
              set({ zone: { ...z, ...bc, shape: "polygon", polygon: draft, set: true } });
              setDraft([]);
            }}
          />
          {z.shape === "polygon" ? (
            <Button label="Revenir à une zone circulaire" small variant="ghost" disabled={disabled} onPress={() => set({ zone: { ...z, shape: "circle", polygon: [] } })} />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapBox: { height: 280, borderRadius: 14, overflow: "hidden", backgroundColor: colors.abyss },
  crosshair: { position: "absolute", left: "50%", top: "50%", width: 24, height: 24, marginLeft: -12, marginTop: -12, alignItems: "center", justifyContent: "center" },
  crossH: { position: "absolute", width: 24, height: 1.5, backgroundColor: colors.warn },
  crossV: { position: "absolute", width: 1.5, height: 24, backgroundColor: colors.warn },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
