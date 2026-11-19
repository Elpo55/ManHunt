/**
 * État et demandes d'autorisations de localisation.
 * Les invites système ne sont déclenchées qu'après une explication à l'écran
 * (écran « Autorisations »), jamais au lancement de l'application.
 */
import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

export interface LocationPermissionState {
  services: boolean;
  foreground: Location.PermissionStatus | "unknown";
  background: Location.PermissionStatus | "unknown";
  canAskForeground: boolean;
  canAskBackground: boolean;
  precise: boolean;
}

const UNKNOWN: LocationPermissionState = {
  services: true,
  foreground: "unknown",
  background: "unknown",
  canAskForeground: true,
  canAskBackground: true,
  precise: true,
};

export async function readPermissions(): Promise<LocationPermissionState> {
  const [services, fg, bg] = await Promise.all([
    Location.hasServicesEnabledAsync(),
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  const precise = Platform.OS === "android" ? fg.android?.accuracy !== "coarse" : fg.ios?.accuracy !== "reduced";
  return {
    services,
    foreground: fg.status,
    background: bg.status,
    canAskForeground: fg.canAskAgain,
    canAskBackground: bg.canAskAgain,
    precise,
  };
}

/** Relit l'état à chaque retour au premier plan (changement dans les réglages système). */
export function useLocationPermissions() {
  const [state, setState] = useState<LocationPermissionState>(UNKNOWN);
  const refresh = useCallback(async () => {
    try {
      setState(await readPermissions());
    } catch {
      /* module indisponible (ex. simulateur sans GPS) */
    }
  }, []);
  useEffect(() => {
    // Lecture asynchrone d'un système externe (permissions OS) : l'état est
    // mis à jour après la réponse, pas de rendu en cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => sub.remove();
  }, [refresh]);

  const requestForeground = useCallback(async () => {
    await Location.requestForegroundPermissionsAsync();
    await refresh();
  }, [refresh]);

  /** À demander APRÈS le premier plan (exigence iOS/Android). */
  const requestBackground = useCallback(async () => {
    await Location.requestBackgroundPermissionsAsync();
    await refresh();
  }, [refresh]);

  return { state, refresh, requestForeground, requestBackground, openSettings: () => Linking.openSettings() };
}
