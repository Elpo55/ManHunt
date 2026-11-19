/** Téléchargement de la carte d'une zone (consultation hors réseau uniquement). */
import type { GameZone } from "@traque/shared";
import { useState } from "react";
import { downloadZone, estimateTiles, offlineSupported, OFFLINE_MAX_TILES } from "../lib/offline";
import { Button, Notice, Panel, SectionTitle, T } from "./ui";

export function OfflineDownload({ zone, name }: { zone: GameZone; name: string }) {
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!zone.set || !offlineSupported()) return null;
  const tiles = estimateTiles(zone);
  const tooBig = tiles > OFFLINE_MAX_TILES;
  return (
    <Panel>
      <SectionTitle>Carte hors ligne</SectionTitle>
      <T v="small">
        {`Enregistre le fond de carte de la zone (~${tiles} tuiles, quelques Mo) pour le consulter sans réseau. Le jeu lui-même (positions, captures) exige toujours une connexion.`}
      </T>
      {tooBig ? <Notice tone="warn">Zone trop grande pour un téléchargement.</Notice> : null}
      {percent !== null ? <T v="caption">{percent >= 100 ? "Carte enregistrée." : `Téléchargement… ${percent} %`}</T> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        label={percent !== null && percent < 100 ? "Téléchargement en cours" : "Télécharger la carte de la zone"}
        small
        variant="secondary"
        icon="download"
        disabled={tooBig || (percent !== null && percent < 100)}
        onPress={async () => {
          setError(null);
          setPercent(0);
          try {
            await downloadZone(zone, name, setPercent, (m) => {
              setError(`Téléchargement interrompu : ${m}`);
              setPercent(null);
            });
          } catch (e) {
            setError((e as Error).message);
            setPercent(null);
          }
        }}
      />
    </Panel>
  );
}
