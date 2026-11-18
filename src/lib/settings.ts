"use client";
/** Préférences locales de l'appareil (non critiques : stockage navigateur). */
import { useSyncExternalStore } from "react";

export interface Settings {
  haptics: boolean;
  reducedMotion: boolean;
  showCoordinates: boolean;
  confirmMoves: boolean;
  showDiagnostics: boolean;
}

const DEFAULTS: Settings = {
  haptics: true,
  reducedMotion: false,
  showCoordinates: false,
  confirmMoves: true,
  showDiagnostics: false,
};
const KEY = "pt.settings.v1";

let current: Settings = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) current = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    current = DEFAULTS;
  }
  applyDom();
}

function applyDom() {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.reducedMotion = String(current.reducedMotion);
  }
}

export function getSettings(): Settings {
  load();
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  load();
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* stockage indisponible : préférence valable pour cette session seulement */
  }
  applyDom();
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSettings,
    () => DEFAULTS,
  );
}

export function vibrate(pattern: number | number[]) {
  if (!getSettings().haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* non supporté */
  }
}
