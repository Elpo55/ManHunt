/**
 * Recherche de lieu (géocodage), utilisée par l'hôte pour choisir la zone de
 * jeu. Aucune position de joueur n'est envoyée.
 *
 * Défaut : Nominatim public (OpenStreetMap). Politique d'usage :
 * https://operations.osmfoundation.org/policies/nominatim/
 *   - 1 requête/s maximum, pas de saisie semi-automatique ;
 *   - application identifiée par son User-Agent ;
 *   - attribution OSM.
 * Ce module : recherche à la validation seulement, 1 requête/s, cache.
 * Autre service compatible (Nominatim auto-hébergé…) : EXPO_PUBLIC_GEOCODER_URL.
 */
export interface Place {
  label: string;
  lat: number;
  lng: number;
  /** rayon suggéré (m) d'après l'emprise du résultat */
  suggestedRadius: number;
}

export const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org/search";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

export function parseNominatim(results: NominatimResult[]): Place[] {
  return results.slice(0, 6).map((r) => {
    let radius = 500;
    if (r.boundingbox) radius = Math.round(((Number(r.boundingbox[1]) - Number(r.boundingbox[0])) * 111_320) / 2);
    return {
      label: r.display_name.split(",").slice(0, 3).join(",").trim(),
      lat: Number(r.lat),
      lng: Number(r.lon),
      suggestedRadius: Math.max(150, Math.min(3000, Math.round(radius / 50) * 50)),
    };
  });
}

export function createGeocoder(opts: { url?: string; userAgent: string; fetchImpl?: typeof fetch }) {
  const url = opts.url?.trim() || DEFAULT_GEOCODER_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const cache = new Map<string, Place[]>();
  let lastCall = 0;

  return async function searchPlaces(query: string): Promise<Place[]> {
    const q = query.trim();
    if (q.length < 3) return [];
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit) return hit;
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const u = `${url}?${new URLSearchParams({ q, format: "jsonv2", limit: "6", "accept-language": "fr" })}`;
    const res = await doFetch(u, { headers: { Accept: "application/json", "User-Agent": opts.userAgent } });
    if (!res.ok) throw new Error(res.status === 429 ? "Trop de recherches : réessayez dans quelques secondes." : "Recherche indisponible.");
    const places = parseNominatim((await res.json()) as NominatimResult[]);
    cache.set(key, places);
    return places;
  };
}
