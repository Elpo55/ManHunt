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

const NAME = process.env.EXPO_PUBLIC_APP_NAME?.trim() || "Projet Traque";
const BUNDLE_ID = process.env.APP_BUNDLE_ID?.trim() || "com.example.projettraque";

const LOCATION_TEXT =
  "Votre position est partagée avec les joueurs de votre partie uniquement pendant une partie active, après votre accord. Le partage s'arrête à la fin de la partie ou quand vous appuyez sur Arrêt.";
const BACKGROUND_TEXT =
  "Pour continuer la partie écran éteint, la position peut être envoyée en arrière-plan, uniquement pendant une partie active. Une notification reste visible tant que le partage est actif.";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME,
  slug: "projet-traque",
  scheme: "traque",
  version: "0.2.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#050608",
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_TEXT,
      NSLocationAlwaysAndWhenInUseUsageDescription: BACKGROUND_TEXT,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
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
  ],
  experiments: { typedRoutes: false },
  extra: {
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
