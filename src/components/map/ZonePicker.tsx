"use client";
/**
 * Choix de la zone de jeu sur la carte réelle (hôte).
 *  - recherche d'un lieu (géocodage OSM, à la validation uniquement),
 *  - le centre de la zone suit le centre de la carte (réticule),
 *  - rayon réglable, aperçu du cercle et de la taille des cases.
 * Aucune géolocalisation de l'appareil.
 */
import type { GeoJSONSource } from "maplibre-gl";
import { Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BOUNDS, zoneCells } from "@/lib/engine/config";
import type { GameZone } from "@/lib/engine/types";
import { circleRing, formatMeters, zoneBounds } from "@/lib/map/geo";
import { searchPlaces, type Place } from "@/lib/map/geocode";
import { GAME_COLORS } from "@/lib/map/layers";
import { Button, Input, RangeField } from "../ui/primitives";
import { useMapLibre } from "./useMapLibre";

function circleData(z: GameZone) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [circleRing([z.lng, z.lat], z.radius_m, 96)] },
      },
    ],
  };
}

export default function ZonePicker({
  value,
  onChange,
  disabled,
}: {
  value: GameZone;
  onChange: (z: GameZone) => void;
  disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { map, status, error } = useMapLibre(container, {
    center: [value.lng, value.lat],
    bounds: zoneBounds(value, 0.25),
  });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  // Cercle de zone + suivi du centre de la carte.
  useEffect(() => {
    if (!map) return;
    if (!map.getSource("zone")) {
      map.addSource("zone", { type: "geojson", data: circleData(valueRef.current) });
      map.addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": GAME_COLORS.volt, "fill-opacity": 0.08 } });
      map.addLayer({ id: "zone-line", type: "line", source: "zone", paint: { "line-color": GAME_COLORS.volt, "line-width": 1.5, "line-opacity": 0.8 } });
    }
    if (disabled) return;
    const onMove = () => {
      const c = map.getCenter();
      const next = { ...valueRef.current, lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) };
      (map.getSource("zone") as GeoJSONSource).setData(circleData(next));
    };
    const onEnd = () => {
      const c = map.getCenter();
      const cur = valueRef.current;
      const lat = Number(c.lat.toFixed(6));
      const lng = Number(c.lng.toFixed(6));
      if (Math.abs(lat - cur.lat) > 1e-6 || Math.abs(lng - cur.lng) > 1e-6) onChangeRef.current({ ...cur, lat, lng });
    };
    map.on("move", onMove);
    map.on("moveend", onEnd);
    return () => {
      map.off("move", onMove);
      map.off("moveend", onEnd);
    };
  }, [map, disabled]);

  // Mise à jour du cercle quand le rayon change.
  useEffect(() => {
    if (!map) return;
    (map.getSource("zone") as GeoJSONSource | undefined)?.setData(circleData(value));
  }, [map, value]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await searchPlaces(query));
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function choose(p: Place) {
    const z: GameZone = { lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)), radius_m: value.radius_m, label: p.label.slice(0, 80) };
    onChange(z);
    setResults(null);
    map?.fitBounds(zoneBounds(z, 0.25), { duration: 600 });
  }

  const cells = zoneCells(value.radius_m);
  const cell = (2 * value.radius_m) / cells;

  return (
    <div className="space-y-4">
      {!disabled ? (
        <form onSubmit={search} className="flex gap-2" role="search">
          <Input
            aria-label="Rechercher un lieu"
            placeholder="Quartier, rue, ville…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11"
          />
          <Button type="submit" variant="secondary" loading={searching} disabled={query.trim().length < 3} icon={<Search className="size-4" />}>
            Chercher
          </Button>
        </form>
      ) : null}
      {searchError ? <p className="text-sm text-hunter">{searchError}</p> : null}
      {results ? (
        results.length ? (
          <ul className="overflow-hidden rounded-[var(--radius-control)] bg-slate">
            {results.map((p) => (
              <li key={`${p.lat},${p.lng}`}>
                <button type="button" onClick={() => choose(p)} className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-2">
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fog">Aucun lieu trouvé.</p>
        )
      ) : null}

      <div className="relative h-72 overflow-hidden rounded-[var(--radius-control)] bg-abyss sm:h-80">
        <div ref={container} className="absolute inset-0" aria-label="Carte de choix de la zone" role="application" />
        {!disabled ? (
          <svg className="pointer-events-none absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="#ece8df" strokeWidth={1.5} />
          </svg>
        ) : null}
        {status !== "ready" ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-fog">
            {error ? `Carte indisponible : ${error}` : "Chargement de la carte…"}
          </p>
        ) : null}
      </div>
      {!disabled ? <p className="text-xs text-fog">Faites glisser la carte : le centre de la zone suit le réticule.</p> : null}

      <RangeField
        label="Rayon de la zone"
        value={value.radius_m}
        {...BOUNDS.zone_radius_m}
        disabled={disabled}
        format={formatMeters}
        onChange={(v) => onChange({ ...value, radius_m: v })}
        hint={`${cells} × ${cells} cases d'environ ${formatMeters(cell)} : un pas = une case.`}
      />
    </div>
  );
}
