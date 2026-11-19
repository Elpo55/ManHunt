/**
 * Suivi GPS — uniquement pendant une partie active, après consentement.
 *
 * Deux modes, choisis automatiquement :
 *  - PREMIER PLAN (toujours) : watchPositionAsync tant que l'écran de jeu est ouvert ;
 *  - ARRIÈRE-PLAN (si l'utilisateur a accordé « Toujours » / localisation en
 *    arrière-plan) : startLocationUpdatesAsync avec service de premier plan
 *    Android (notification permanente « Partage de position actif »).
 *
 * Garde-fous :
 *  - la partie suivie est mémorisée (AsyncStorage) ; si elle n'est plus active,
 *    la tâche d'arrière-plan s'arrête d'elle-même ;
 *  - stopTracking() est appelé à la fin de partie, à l'abandon, à l'arrêt de
 *    sécurité, à la déconnexion et quand on quitte l'écran de jeu ;
 *  - la fréquence d'envoi est limitée (intervalle de la partie, 3 s minimum).
 *
 * Limites réelles (documentées dans docs/MIGRATION_MOBILE_GPS.md §6) : iOS
 * peut espacer les mises à jour en arrière-plan ; certains Android coupent
 * les applications ; si l'utilisateur ferme l'application, le suivi s'arrête.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { DeviceFix } from "@traque/shared";
import { gameApi } from "../api";

export const BACKGROUND_TASK = "traque-background-location";
const ACTIVE_KEY = "traque.activeTracking";

interface ActiveTracking {
  gameId: string;
  intervalS: number;
  startedAt: number;
  /** décalage horloge serveur - appareil (ms) */
  offsetMs: number;
}

type FixListener = (fix: DeviceFix) => void;
let listener: FixListener | null = null;
let watch: Location.LocationSubscription | null = null;
let lastBackgroundSend = 0;

export function toFix(l: Location.LocationObject): DeviceFix {
  return {
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? 999,
    timestamp: l.timestamp,
    speed: l.coords.speed,
    heading: l.coords.heading,
  };
}

/**
 * Tâche d'arrière-plan (déclarée au niveau module, importée par le layout racine).
 * Si l'interface est vivante, la mesure part vers le contrôleur (qui l'envoie) ;
 * sinon (application en arrière-plan sans interface), envoi direct au serveur.
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const active = await readActive();
  if (!active) {
    await stopBackgroundUpdates();
    return;
  }
  const fix = toFix(data.locations[data.locations.length - 1]);
  if (listener) {
    listener(fix);
    return;
  }
  if (Date.now() - lastBackgroundSend < active.intervalS * 1000) return;
  lastBackgroundSend = Date.now();
  try {
    await gameApi.reportPosition(active.gameId, { ...fix, timestamp: fix.timestamp + (active.offsetMs ?? 0) });
  } catch (e) {
    const code = (e as { code?: string }).code;
    // Partie finie, joueur éliminé ou consentement retiré : arrêt immédiat.
    if (code && ["E_GAME_FINISHED", "E_NOT_ACTIVE", "E_CONSENT_REQUIRED", "E_NOT_PARTICIPANT"].includes(code)) {
      await stopTracking();
    }
  }
});

async function readActive(): Promise<ActiveTracking | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as ActiveTracking) : null;
  } catch {
    return null;
  }
}

async function stopBackgroundUpdates() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK)) await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
  } catch {
    /* tâche non démarrée */
  }
}

export interface TrackingResult {
  foreground: boolean;
  background: boolean;
}

/**
 * Les démarrages/arrêts sont sérialisés : sans cela, un arrêt lancé pendant
 * un démarrage (fin de partie, changement d'écran rapide) pouvait laisser un
 * abonnement GPS actif après la partie (watchPositionAsync résolu après le
 * stop) ou effacer la partie mémorisée d'un nouveau démarrage.
 */
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Démarre le suivi pour une partie. N'appelle jamais les invites de permission. */
export function startTracking(gameId: string, intervalS: number, offsetMs: number, onFix: FixListener): Promise<TrackingResult> {
  const gen = ++generation;
  return serialized(async () => {
    // Un arrêt (ou un autre démarrage) a été demandé entre-temps : rien à faire.
    if (gen !== generation) return { foreground: false, background: false };
    listener = onFix;
    const interval = Math.max(3, intervalS) * 1000;
    await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify({ gameId, intervalS: Math.max(3, intervalS), startedAt: Date.now(), offsetMs } satisfies ActiveTracking));

    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return { foreground: false, background: false };

    watch?.remove();
    watch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: interval, distanceInterval: 3, mayShowUserSettingsDialog: true },
      (l) => listener?.(toFix(l)),
    );

    let background = false;
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.granted) {
      try {
        await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: interval,
          distanceInterval: 5,
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.Fitness,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: "Partage de position actif",
            notificationBody: "Pendant la partie uniquement. Ouvrez l'application pour l'arrêter.",
            notificationColor: "#2F6BFF",
            killServiceOnDestroy: true,
          },
        });
        background = true;
      } catch {
        background = false; // repli : premier plan seulement
      }
    }
    return { foreground: true, background };
  });
}

/** Arrête tout suivi (premier plan + arrière-plan) et oublie la partie. */
export function stopTracking(): Promise<void> {
  ++generation;
  // Effet immédiat : plus aucune mesure n'est transmise, même avant la fin de la file.
  listener = null;
  return serialized(async () => {
    listener = null;
    watch?.remove();
    watch = null;
    await AsyncStorage.removeItem(ACTIVE_KEY).catch(() => undefined);
    await stopBackgroundUpdates();
  });
}

/** À l'ouverture de l'application : coupe un suivi orphelin (partie terminée, crash…). */
export async function cleanupOrphanTracking(isGameStillActive: (gameId: string) => Promise<boolean>) {
  const active = await readActive();
  if (!active) {
    await stopBackgroundUpdates();
    return;
  }
  const stillActive = await isGameStillActive(active.gameId).catch(() => false);
  if (!stillActive) await stopTracking();
}
