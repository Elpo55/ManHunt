/**
 * Notifications LOCALES (affichées par le téléphone lui-même).
 *
 * Elles sont déclenchées par l'application quand elle reçoit un événement de
 * partie alors qu'elle est en arrière-plan (écran éteint) : c'est possible
 * tant que le suivi GPS d'arrière-plan maintient l'application active
 * (service de premier plan Android, localisation « Toujours » iOS).
 *
 * Limite assumée : ce ne sont PAS des notifications push distantes. Si
 * l'application est complètement fermée (balayée), aucune notification ne
 * peut arriver — il faudrait un service push (FCM / APNs), non utilisé.
 */
import * as Notifications from "expo-notifications";
import { AndroidImportance, AndroidNotificationVisibility } from "expo-notifications";
import { AppState, Platform } from "react-native";
import { getSettings, type NotifyCategory } from "./settings";

const CHANNEL = "game-events";
const lastByKey = new Map<string, number>();
let prepared = false;

Notifications.setNotificationHandler({
  // Au premier plan, l'application affiche ses propres bannières : pas de doublon système.
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
});

async function prepare() {
  if (prepared) return;
  prepared = true;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Événements de partie",
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
    }).catch(() => undefined);
  }
}

export async function notificationPermission(): Promise<"granted" | "denied" | "undetermined"> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

/** À appeler après explication (écran Autorisations / Réglages), jamais au lancement. */
export async function requestNotificationPermission(): Promise<boolean> {
  await prepare();
  const r = await Notifications.requestPermissionsAsync();
  return r.granted;
}

/**
 * Notifie si : application en arrière-plan, notifications activées, catégorie
 * activée, et pas de notification identique récente (anti-répétition).
 */
export async function notifyLocal(category: NotifyCategory, title: string, body: string, opts: { key?: string; minIntervalMs?: number } = {}) {
  const s = getSettings();
  if (!s.notifications || !s.notify[category]) return;
  if (AppState.currentState === "active") return;
  const key = opts.key ?? `${category}:${body}`;
  const now = Date.now();
  if (now - (lastByKey.get(key) ?? 0) < (opts.minIntervalMs ?? 20_000)) return;
  lastByKey.set(key, now);
  try {
    await prepare();
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true, ...(Platform.OS === "android" ? { channelId: CHANNEL } : {}) },
      trigger: null,
    });
  } catch {
    /* notifications indisponibles : le journal de partie reste la référence */
  }
}

/** Retire les notifications de partie (fin de partie, retour au premier plan). */
export async function clearGameNotifications() {
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
}
