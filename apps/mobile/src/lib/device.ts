/**
 * État de l'appareil transmis aux coéquipiers via le heartbeat :
 * batterie (API officielle expo-battery, indisponible sur certains
 * simulateurs → null), application au premier plan ou non, état du GPS.
 */
import type { HealthReport } from "@traque/shared";
import * as Battery from "expo-battery";
import { AppState } from "react-native";

let battery: number | null = null;
let batteryAt = 0;

async function refreshBattery() {
  if (Date.now() - batteryAt < 60_000) return;
  batteryAt = Date.now();
  try {
    const level = await Battery.getBatteryLevelAsync();
    battery = level >= 0 ? Math.round(level * 100) : null; // -1 = inconnu
  } catch {
    battery = null;
  }
}

/**
 * @param gps état GPS vu par l'application (autorisation + fraîcheur de la dernière mesure)
 */
export function healthReport(gps: HealthReport["gps_state"]): HealthReport {
  void refreshBattery();
  return { app_state: AppState.currentState === "active" ? "foreground" : "background", gps_state: gps, battery };
}
