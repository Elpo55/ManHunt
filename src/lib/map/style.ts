/**
 * Style cartographique sombre « Nocturne » (schéma OpenMapTiles).
 * Fond très sombre, routes discrètes mais lisibles, bâtiments légèrement
 * contrastés, étiquettes rares. Les couleurs vives sont réservées au jeu.
 */
import type { StyleSpecification, ExpressionSpecification } from "maplibre-gl";
import type { MapProvider } from "./provider";

export const MAP_COLORS = {
  background: "#0b0d11",
  landuse: "#0d1014",
  park: "#0d1512",
  water: "#08111d",
  waterLine: "#0c1a2c",
  building: "#161a21",
  buildingEdge: "#1e232c",
  roadMinor: "#1d2129",
  roadMajor: "#272c37",
  roadMotorway: "#313746",
  path: "#1a1e26",
  rail: "#1c2029",
  label: "#7d838e",
  labelMinor: "#555b66",
  halo: "#0b0d11",
} as const;

const FONT = ["Noto Sans Regular"];
const NAME: ExpressionSpecification = ["coalesce", ["get", "name:fr"], ["get", "name:latin"], ["get", "name"]];

function lineWidth(base: number, max: number): ExpressionSpecification {
  return ["interpolate", ["exponential", 1.5], ["zoom"], 12, base, 18, max];
}

export function buildDarkStyle(provider: MapProvider): StyleSpecification {
  return {
    version: 8,
    name: "Nocturne",
    glyphs: provider.glyphsUrl,
    sources: {
      openmaptiles: { type: "vector", url: provider.tilesUrl, attribution: provider.attribution },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": MAP_COLORS.background } },
      {
        id: "landuse",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["in", ["get", "class"], ["literal", ["residential", "commercial", "industrial", "retail"]]],
        paint: { "fill-color": MAP_COLORS.landuse },
      },
      {
        id: "landcover-green",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["grass", "wood", "farmland"]]],
        paint: { "fill-color": MAP_COLORS.park, "fill-opacity": 0.9 },
      },
      {
        id: "park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": MAP_COLORS.park },
      },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": MAP_COLORS.water } },
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        paint: { "line-color": MAP_COLORS.waterLine, "line-width": lineWidth(0.5, 4) },
      },
      {
        id: "building",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": MAP_COLORS.building,
          "fill-outline-color": MAP_COLORS.buildingEdge,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, 1],
        },
      },
      {
        id: "road-path",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 14,
        filter: ["in", ["get", "class"], ["literal", ["path", "track"]]],
        paint: { "line-color": MAP_COLORS.path, "line-width": lineWidth(0.4, 1.6), "line-dasharray": [2, 2] },
      },
      {
        id: "rail",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["rail", "transit"]]],
        paint: { "line-color": MAP_COLORS.rail, "line-width": lineWidth(0.5, 2), "line-dasharray": [3, 3] },
      },
      {
        id: "road-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": MAP_COLORS.roadMinor, "line-width": lineWidth(0.5, 9) },
      },
      {
        id: "road-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "trunk"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": MAP_COLORS.roadMajor, "line-width": lineWidth(0.8, 14) },
      },
      {
        id: "road-motorway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["==", ["get", "class"], "motorway"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": MAP_COLORS.roadMotorway, "line-width": lineWidth(1, 16) },
      },
      {
        id: "road-label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 15,
        layout: {
          "symbol-placement": "line",
          "text-field": NAME,
          "text-font": FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 13],
        },
        paint: { "text-color": MAP_COLORS.labelMinor, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.2 },
      },
      {
        id: "place-label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "suburb", "neighbourhood", "quarter"]]],
        layout: {
          "text-field": NAME,
          "text-font": FONT,
          "text-size": ["match", ["get", "class"], ["city", "town"], 14, 11],
          "text-max-width": 8,
        },
        paint: { "text-color": MAP_COLORS.label, "text-halo-color": MAP_COLORS.halo, "text-halo-width": 1.4 },
      },
    ],
  };
}

/** Style effectif : style externe imposé, sinon style sombre intégré. */
export function resolveStyle(provider: MapProvider): string | StyleSpecification {
  return provider.styleUrl ?? buildDarkStyle(provider);
}
