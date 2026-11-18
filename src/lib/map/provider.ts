/**
 * Fournisseurs de tuiles vectorielles OpenStreetMap — interchangeables.
 *
 * Le composant carte ne connaît qu'un `MapProvider` : changer de fournisseur
 * ne demande qu'une variable d'environnement, jamais une réécriture.
 *
 * Tous les fournisseurs listés servent le schéma OpenMapTiles, utilisé par
 * notre style sombre (src/lib/map/style.ts). Un style externe complet peut
 * aussi être imposé avec NEXT_PUBLIC_MAP_STYLE_URL.
 *
 * Pourquoi pas tile.openstreetmap.org ? Ce sont des tuiles raster (style non
 * personnalisable) et la politique d'usage de l'OSMF interdit de s'en servir
 * comme infrastructure d'application : https://operations.osmfoundation.org/policies/tiles/
 */

export type ProviderId = "openfreemap" | "maptiler" | "custom";

export interface MapProvider {
  id: ProviderId;
  label: string;
  /** TileJSON de la source vectorielle (schéma OpenMapTiles) */
  tilesUrl: string;
  /** Modèle d'URL des polices (glyphes) */
  glyphsUrl: string;
  /** Style complet externe : remplace le style intégré si défini */
  styleUrl?: string;
  /** Attribution obligatoire affichée sur la carte */
  attribution: string;
}

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

export interface ProviderEnv {
  NEXT_PUBLIC_MAP_PROVIDER?: string;
  NEXT_PUBLIC_MAPTILER_KEY?: string;
  NEXT_PUBLIC_MAP_TILES_URL?: string;
  NEXT_PUBLIC_MAP_GLYPHS_URL?: string;
  NEXT_PUBLIC_MAP_STYLE_URL?: string;
  NEXT_PUBLIC_MAP_ATTRIBUTION?: string;
}

/** Résout le fournisseur à partir de l'environnement (pur, testable). */
export function resolveProvider(env: ProviderEnv): MapProvider {
  const id = (env.NEXT_PUBLIC_MAP_PROVIDER?.trim().toLowerCase() || "openfreemap") as ProviderId;
  const styleUrl = env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || undefined;
  const extraAttribution = env.NEXT_PUBLIC_MAP_ATTRIBUTION?.trim();

  if (id === "maptiler" && env.NEXT_PUBLIC_MAPTILER_KEY?.trim()) {
    const key = encodeURIComponent(env.NEXT_PUBLIC_MAPTILER_KEY.trim());
    return {
      id,
      label: "MapTiler",
      tilesUrl: `https://api.maptiler.com/tiles/v3-openmaptiles/tiles.json?key=${key}`,
      glyphsUrl: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`,
      styleUrl,
      attribution: `<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">© MapTiler</a> ${OSM_ATTRIBUTION}`,
    };
  }

  if (id === "custom" && env.NEXT_PUBLIC_MAP_TILES_URL?.trim()) {
    return {
      id,
      label: "Personnalisé",
      tilesUrl: env.NEXT_PUBLIC_MAP_TILES_URL.trim(),
      glyphsUrl: env.NEXT_PUBLIC_MAP_GLYPHS_URL?.trim() || "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      styleUrl,
      attribution: extraAttribution || OSM_ATTRIBUTION,
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
    attribution: `<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ${OSM_ATTRIBUTION}`,
  };
}

export function getProvider(): MapProvider {
  return resolveProvider({
    NEXT_PUBLIC_MAP_PROVIDER: process.env.NEXT_PUBLIC_MAP_PROVIDER,
    NEXT_PUBLIC_MAPTILER_KEY: process.env.NEXT_PUBLIC_MAPTILER_KEY,
    NEXT_PUBLIC_MAP_TILES_URL: process.env.NEXT_PUBLIC_MAP_TILES_URL,
    NEXT_PUBLIC_MAP_GLYPHS_URL: process.env.NEXT_PUBLIC_MAP_GLYPHS_URL,
    NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
    NEXT_PUBLIC_MAP_ATTRIBUTION: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION,
  });
}
