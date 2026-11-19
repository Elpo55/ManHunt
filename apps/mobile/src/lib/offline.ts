/**
 * Cartes pré-téléchargées (consultation hors réseau uniquement).
 *
 * Le pack MapLibre est créé avec le style officiel d'OpenFreeMap, qui utilise
 * exactement la même source de tuiles que la carte du jeu : les tuiles
 * enregistrées sont réutilisées sans réseau. Le multijoueur et l'envoi GPS,
 * eux, exigent toujours une connexion.
 *
 * Usage raisonnable (conditions OpenFreeMap) : uniquement la zone de jeu,
 * zooms 12 à 16, 4 000 tuiles au maximum par pack.
 */
import { OfflineManager, type OfflinePack } from "@maplibre/maplibre-react-native";
import { zoneBounds, type GameZone } from "@traque/shared";
import { mapProvider } from "./env";

export const OFFLINE_MAX_TILES = 4000;
const OFFLINE_STYLE: Record<string, string | undefined> = {
  openfreemap: "https://tiles.openfreemap.org/styles/dark",
};

export function offlineSupported(): boolean {
  return !!(mapProvider.styleUrl ?? OFFLINE_STYLE[mapProvider.id]);
}

/** Estimation du nombre de tuiles (pour prévenir l'utilisateur avant téléchargement). */
export function estimateTiles(zone: GameZone, minZoom = 12, maxZoom = 16): number {
  const b = zoneBounds(zone, zone.radius_m, 0.15);
  let n = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const x = (lng: number) => ((lng + 180) / 360) * 2 ** z;
    const y = (lat: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
    n += (Math.floor(x(b.ne[0])) - Math.floor(x(b.sw[0])) + 1) * (Math.floor(y(b.sw[1])) - Math.floor(y(b.ne[1])) + 1);
  }
  return n;
}

export interface OfflineArea {
  id: string;
  name: string;
  percent: number;
  bytes: number;
  complete: boolean;
}

export async function listOfflineAreas(): Promise<OfflineArea[]> {
  const packs = await OfflineManager.getPacks();
  const out: OfflineArea[] = [];
  for (const p of packs) {
    const st = await p.status().catch(() => null);
    const meta = (p.metadata ?? {}) as { name?: string };
    out.push({
      id: p.id,
      name: meta.name ?? "Zone",
      percent: st?.percentage ?? 0,
      bytes: st?.completedTileSize ?? 0,
      complete: st?.state === "complete",
    });
  }
  return out;
}

export async function downloadZone(zone: GameZone, name: string, onProgress: (percent: number) => void, onError: (message: string) => void): Promise<OfflinePack> {
  const style = mapProvider.styleUrl ?? OFFLINE_STYLE[mapProvider.id];
  if (!style) throw new Error("Téléchargement hors ligne indisponible pour ce fournisseur de carte.");
  if (estimateTiles(zone) > OFFLINE_MAX_TILES) throw new Error("Zone trop grande pour un téléchargement (réduisez le rayon).");
  OfflineManager.setTileCountLimit(OFFLINE_MAX_TILES);
  const b = zoneBounds(zone, zone.radius_m, 0.15);
  return OfflineManager.createPack(
    { mapStyle: style, bounds: [b.sw[0], b.sw[1], b.ne[0], b.ne[1]], minZoom: 12, maxZoom: 16, metadata: { name: name.slice(0, 60), at: Date.now() } },
    (_pack, status) => onProgress(Math.round(status.percentage ?? 0)),
    (_pack, err) => onError(err.message),
  );
}

export const deleteOfflineArea = (id: string) => OfflineManager.deletePack(id);
