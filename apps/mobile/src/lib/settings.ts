/** Préférences locales (non sensibles) de l'appareil. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";

export type NotifyCategory = "proximity" | "radar" | "capture" | "phase" | "team" | "safety";

export const NOTIFY_LABEL: Record<NotifyCategory, { label: string; description: string }> = {
  proximity: { label: "Adversaire proche", description: "Un Chasseur s'approche, un Fugitif est détecté près de vous." },
  radar: { label: "Radar et révélations", description: "Impulsions radar, révélations de Mister X, réductions de zone." },
  capture: { label: "Captures", description: "Un joueur est capturé ou éliminé." },
  phase: { label: "Début et fin de partie", description: "La traque commence, pause, fin de partie." },
  team: { label: "Équipe", description: "Messages rapides, repères, balises atteintes." },
  safety: { label: "Sécurité", description: "SOS, GPS muet, interventions de l'administration (recommandé)." },
};

export interface Settings {
  haptics: boolean;
  keepAwake: boolean;
  /** notifications locales quand l'application est en arrière-plan */
  notifications: boolean;
  notify: Record<NotifyCategory, boolean>;
  /** mise à jour facultative ignorée (numéro de build) */
  dismissedBuild: number | null;
}

const KEY = "traque.settings.v1";
const DEFAULTS: Settings = {
  haptics: true,
  keepAwake: true,
  notifications: true,
  notify: { proximity: true, radar: true, capture: true, phase: true, team: true, safety: true },
  dismissedBuild: null,
};
let current: Settings = DEFAULTS;
const listeners = new Set<(s: Settings) => void>();
void AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      current = { ...DEFAULTS, ...saved, notify: { ...DEFAULTS.notify, ...(saved.notify ?? {}) } };
    }
    listeners.forEach((l) => l(current));
  })
  .catch(() => undefined);

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  void AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => undefined);
  listeners.forEach((l) => l(current));
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return [s, updateSettings];
}

export function haptic(kind: "light" | "success" | "warning") {
  if (!current.haptics) return;
  if (kind === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else void Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
}
