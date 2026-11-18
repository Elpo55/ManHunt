/** Préférences locales (non sensibles) de l'appareil. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";

export interface Settings {
  haptics: boolean;
  keepAwake: boolean;
}

const KEY = "traque.settings.v1";
const DEFAULTS: Settings = { haptics: true, keepAwake: true };
let current: Settings = DEFAULTS;
const listeners = new Set<(s: Settings) => void>();
void AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) current = { ...DEFAULTS, ...JSON.parse(raw) };
    listeners.forEach((l) => l(current));
  })
  .catch(() => undefined);

export function getSettings() {
  return current;
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  const update = (patch: Partial<Settings>) => {
    current = { ...current, ...patch };
    void AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => undefined);
    listeners.forEach((l) => l(current));
  };
  return [s, update];
}

export function haptic(kind: "light" | "success" | "warning") {
  if (!current.haptics) return;
  if (kind === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else void Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
}
