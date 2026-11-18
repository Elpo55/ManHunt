/**
 * Recherche de lieu (géocodage) — utilisée uniquement par l'hôte pour choisir
 * la zone de jeu. Aucune donnée de jeu ni position n'est envoyée.
 *
 * Défaut : Nominatim public (OpenStreetMap). Politique d'usage :
 * https://operations.osmfoundation.org/policies/nominatim/
 *   - 1 requête par seconde maximum, pas de saisie semi-automatique,
 *   - attribution OSM, pas d'usage massif.
 * Ce module applique : recherche à la validation uniquement, 1 requête/s,
 * cache local. Pour un autre service compatible (Nominatim auto-hébergé,
 * Photon…), définir NEXT_PUBLIC_GEOCODER_URL.
 */
export interface Place {
  label: string;
  lat: number;
  lng: number;
  /** rayon suggéré (m) d'après l'emprise du résultat */
  suggestedRadius: number;
}

const DEFAULT_URL = "https://nominatim.openstreetmap.org/search";
let lastCall = 0;
const cache = new Map<string, Place[]>();

export function geocoderUrl(): string {
  return process.env.NEXT_PUBLIC_GEOCODER_URL?.trim() || DEFAULT_URL;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

export function parseNominatim(results: NominatimResult[]): Place[] {
  return results.slice(0, 6).map((r) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    let radius = 600;
    if (r.boundingbox) {
      const [s, n] = [Number(r.boundingbox[0]), Number(r.boundingbox[1])];
      radius = Math.round(((n - s) * 111_320) / 2);
    }
    return {
      label: r.display_name.split(",").slice(0, 3).join(",").trim(),
      lat,
      lng,
      suggestedRadius: Math.max(200, Math.min(3000, Math.round(radius / 50) * 50)),
    };
  });
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = new URL(geocoderUrl());
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", "fr");
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(res.status === 429 ? "Trop de recherches : réessayez dans quelques secondes." : "Recherche indisponible.");
  const places = parseNominatim((await res.json()) as NominatimResult[]);
  cache.set(key, places);
  return places;
}
