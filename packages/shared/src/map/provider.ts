/**
 * Fournisseurs de tuiles vectorielles OpenStreetMap — interchangeables.
 * La carte ne connaît qu'un `MapProvider` : changer de fournisseur = changer
 * une variable d'environnement (EXPO_PUBLIC_MAP_*), jamais le code.
 *
 * Tous servent le schéma OpenMapTiles utilisé par le style sombre intégré.
 * Un style externe complet peut aussi être imposé (MAP_STYLE_URL).
 *
 * Pourquoi pas tile.openstreetmap.org ? Tuiles raster non stylables et
 * politique d'usage de l'OSMF incompatible avec une application :
 * https://operations.osmfoundation.org/policies/tiles/
 */
export type ProviderId = "openfreemap" | "maptiler" | "custom";

export interface MapProvider {
  id: ProviderId;
  label: string;
  /** TileJSON de la source vectorielle (schéma OpenMapTiles) */
  tilesUrl: string;
  glyphsUrl: string;
  styleUrl?: string;
  /** Attribution obligatoire (texte affiché sur la carte) */
  attribution: string;
}

export interface ProviderEnv {
  MAP_PROVIDER?: string;
  MAPTILER_KEY?: string;
  MAP_TILES_URL?: string;
  MAP_GLYPHS_URL?: string;
  MAP_STYLE_URL?: string;
  MAP_ATTRIBUTION?: string;
}

const OSM = "© OpenStreetMap contributors";

export function resolveProvider(env: ProviderEnv): MapProvider {
  const id = (env.MAP_PROVIDER?.trim().toLowerCase() || "openfreemap") as ProviderId;
  const styleUrl = env.MAP_STYLE_URL?.trim() || undefined;

  if (id === "maptiler" && env.MAPTILER_KEY?.trim()) {
    const key = encodeURIComponent(env.MAPTILER_KEY.trim());
    return {
      id,
      label: "MapTiler",
      tilesUrl: `https://api.maptiler.com/tiles/v3-openmaptiles/tiles.json?key=${key}`,
      glyphsUrl: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`,
      styleUrl,
      attribution: `© MapTiler ${OSM}`,
    };
  }
  if (id === "custom" && env.MAP_TILES_URL?.trim()) {
    return {
      id,
      label: "Personnalisé",
      tilesUrl: env.MAP_TILES_URL.trim(),
      glyphsUrl: env.MAP_GLYPHS_URL?.trim() || "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      styleUrl,
      attribution: env.MAP_ATTRIBUTION?.trim() || OSM,
    };
  }
  // Défaut : OpenFreeMap — gratuit, sans clé, données OSM, fourni « tel quel »
  // sans garantie de service (https://openfreemap.org/tos/).
  return {
    id: "openfreemap",
    label: "OpenFreeMap",
    tilesUrl: "https://tiles.openfreemap.org/planet",
    glyphsUrl: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    styleUrl,
    attribution: `OpenFreeMap ${OSM}`,
  };
}
