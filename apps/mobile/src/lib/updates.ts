/**
 * Distribution hors store.
 *
 * 1. Nouvelle version (APK) : la dernière version publiée est lue sur le
 *    serveur (public.app_releases, renseignée par un administrateur) et
 *    comparée au numéro de build RÉELLEMENT installé (lu dans l'application
 *    native). C'est une information pour l'utilisateur, jamais un contrôle de
 *    sécurité (le serveur ne se fie pas à la version annoncée par le client).
 * 2. EAS Update (correctifs JavaScript sans réinstallation) : actif seulement si
 *    le projet est relié à expo.dev (EAS_PROJECT_ID au moment du build). Les
 *    mises à jour ne s'appliquent qu'aux binaires de la même version
 *    (runtimeVersion = version de l'application), donc jamais à un binaire
 *    incompatible.
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Updates from "expo-updates";
import { api, type Release } from "./api";
import { APP_BUILD } from "./env";
import { getSettings } from "./settings";

export interface UpdateInfo {
  release: Release;
  installedBuild: number;
  /** la version installée n'est plus prise en charge */
  required: boolean;
  /** ignorée par l'utilisateur (facultative uniquement) */
  dismissed: boolean;
}

export function installedBuild(): number {
  const n = Number(APP_BUILD);
  return Number.isFinite(n) ? n : 0;
}

export async function checkForRelease(): Promise<UpdateInfo | null> {
  const release = await api.latestRelease(Platform.OS === "ios" ? "ios" : "android");
  const mine = installedBuild();
  if (!release || !mine || release.build <= mine) return null;
  const required = release.severity === "critical" || (release.min_supported_build != null && mine < release.min_supported_build);
  return { release, installedBuild: mine, required, dismissed: !required && getSettings().dismissedBuild === release.build };
}

export function useReleaseCheck() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    let alive = true;
    checkForRelease()
      .then((i) => alive && setInfo(i))
      .catch(() => undefined); // hors ligne : on réessaiera au prochain lancement
    return () => {
      alive = false;
    };
  }, []);
  return [info, setInfo] as const;
}

/** Version JavaScript réellement exécutée (EAS Update) — pour l'écran Réglages. */
export function runningUpdate(): { enabled: boolean; label: string } {
  if (!Updates.isEnabled) return { enabled: false, label: "Mises à jour à distance non configurées (code intégré à l'APK)" };
  if (Updates.isEmbeddedLaunch) return { enabled: true, label: "Code intégré à l'APK (aucune mise à jour à distance appliquée)" };
  return { enabled: true, label: `Mise à jour ${Updates.updateId?.slice(0, 8) ?? "?"} du ${Updates.createdAt?.toLocaleString("fr-FR") ?? "?"}` };
}

/**
 * Vérifie et télécharge une mise à jour JavaScript compatible ; elle est
 * appliquée au prochain démarrage (ou tout de suite si l'utilisateur le demande).
 * En cas d'échec, l'application continue avec le code déjà installé.
 */
export async function fetchJsUpdate(): Promise<"none" | "downloaded" | "disabled" | "error"> {
  if (!Updates.isEnabled) return "disabled";
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return "none";
    await Updates.fetchUpdateAsync();
    return "downloaded";
  } catch {
    return "error";
  }
}

export const reloadApp = () => Updates.reloadAsync();
