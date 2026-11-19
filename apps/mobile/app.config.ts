/**
 * Configuration Expo (générée en projets natifs Android/iOS par prebuild/EAS).
 * Toute permission native est déclarée ici, jamais à la main dans android/ ou ios/.
 *
 * Variables (fichier apps/mobile/.env ou secrets EAS) — toutes PUBLIQUES :
 *   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_APP_NAME,
 *   EXPO_PUBLIC_MAP_PROVIDER, EXPO_PUBLIC_MAPTILER_KEY, EXPO_PUBLIC_MAP_TILES_URL,
 *   EXPO_PUBLIC_MAP_STYLE_URL, EXPO_PUBLIC_GEOCODER_URL
 *   APP_BUNDLE_ID (identifiant iOS/Android, ex. com.votrenom.traque)
 * Aucune clé secrète Supabase (service_role) ne doit jamais apparaître ici.
 */
import type { ConfigContext, ExpoConfig } from "expo/config";
import { version as VERSION } from "./package.json";

/**
 * Version : source unique = apps/mobile/package.json (versionnement sémantique).
 * Numéro de build (Android versionCode / iOS buildNumber) dérivé et toujours
 * croissant : MAJEUR*10000 + MINEUR*100 + CORRECTIF (0.3.0 -> 300, 1.2.3 -> 10203).
 */
export function buildNumber(v: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Version invalide : ${v}`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (min > 99 || pat > 99) throw new Error(`Mineur/correctif limités à 99 : ${v}`);
  return maj * 10000 + min * 100 + pat;
}
const BUILD = buildNumber(VERSION);

const NAME = process.env.EXPO_PUBLIC_APP_NAME?.trim() || "Manhunt";
const BUNDLE_ID = process.env.APP_BUNDLE_ID?.trim() || "com.example.projettraque";

const LOCATION_TEXT =
  "Votre position est partagée avec les joueurs de votre partie uniquement pendant une partie active, après votre accord. Le partage s'arrête à la fin de la partie ou quand vous appuyez sur Arrêt.";
const BACKGROUND_TEXT =
  "Pour continuer la partie écran éteint, la position peut être envoyée en arrière-plan, uniquement pendant une partie active. Une notification reste visible tant que le partage est actif.";

const CAMERA_TEXT = "La caméra sert uniquement à scanner le QR code d'un Fugitif pour confirmer une capture. Aucune photo n'est enregistrée.";
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID?.trim() || undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME,
  slug: "projet-traque",
  scheme: "traque",
  version: VERSION,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#050608",
  ios: {
    bundleIdentifier: BUNDLE_ID,
    buildNumber: String(BUILD),
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_TEXT,
      NSLocationAlwaysAndWhenInUseUsageDescription: BACKGROUND_TEXT,
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: CAMERA_TEXT,
    },
  },
  android: {
    package: BUNDLE_ID,
    versionCode: BUILD,
    adaptiveIcon: {
      backgroundColor: "#050608",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: [
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "VIBRATE",
    ],
    // Permissions ajoutées par défaut par des modules mais inutiles au jeu :
    // retirées du manifeste final (moins d'accès, conformité Play Store).
    blockedPermissions: [
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      // Notifications push distantes non utilisées (notifications locales seulement).
      "com.google.android.c2dm.permission.RECEIVE",
      "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
      "android.permission.RECORD_AUDIO",
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    "@maplibre/maplibre-react-native",
    [
      "expo-splash-screen",
      { backgroundColor: "#050608", image: "./assets/splash-icon.png", imageWidth: 160 },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission: LOCATION_TEXT,
        locationAlwaysAndWhenInUsePermission: BACKGROUND_TEXT,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ["expo-camera", { cameraPermission: CAMERA_TEXT, recordAudioAndroid: false, microphonePermission: false }],
    // Déclaré AVANT expo-notifications : les modifications natives s'exécutent en ordre
    // inverse, ce plugin passe donc après et retire l'autorisation push (notifications
    // LOCALES uniquement ; signature possible avec un compte Apple gratuit).
    "./plugins/withoutPushEntitlement",
    ["expo-notifications", { color: "#2F6BFF" }],
    "expo-updates",
  ],
  // EAS Update : actif seulement si le projet est relié à expo.dev (EAS_PROJECT_ID).
  // runtimeVersion = version de l'application : une mise à jour JavaScript n'est
  // jamais appliquée à un binaire d'une autre version (changements natifs = nouvel APK).
  runtimeVersion: { policy: "appVersion" },
  updates: EAS_PROJECT_ID
    ? { enabled: true, url: `https://u.expo.dev/${EAS_PROJECT_ID}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
    : { enabled: false },
  experiments: { typedRoutes: false },
  extra: {
    eas: EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined,
  },
});
