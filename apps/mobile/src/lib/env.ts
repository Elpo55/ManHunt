/** Variables publiques (EXPO_PUBLIC_*) — jamais de secret ici. */
import { resolveProvider } from "@traque/shared";

export const APP_NAME = process.env.EXPO_PUBLIC_APP_NAME?.trim() || "Projet Traque";
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
export const isConfigured = /^https:\/\/.+/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;

export const mapProvider = resolveProvider({
  MAP_PROVIDER: process.env.EXPO_PUBLIC_MAP_PROVIDER,
  MAPTILER_KEY: process.env.EXPO_PUBLIC_MAPTILER_KEY,
  MAP_TILES_URL: process.env.EXPO_PUBLIC_MAP_TILES_URL,
  MAP_GLYPHS_URL: process.env.EXPO_PUBLIC_MAP_GLYPHS_URL,
  MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
  MAP_ATTRIBUTION: process.env.EXPO_PUBLIC_MAP_ATTRIBUTION,
});

export const GEOCODER_URL = process.env.EXPO_PUBLIC_GEOCODER_URL?.trim() || undefined;
/** User-Agent identifiant l'application (exigé par la politique Nominatim). */
export const USER_AGENT = `ProjetTraque/0.2 (application privée de jeu ; ${APP_NAME})`;
