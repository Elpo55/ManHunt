// La tâche GPS d'arrière-plan doit être déclarée au chargement du bundle,
// avant toute navigation (exigence expo-task-manager).
import { ChakraPetch_600SemiBold } from "@expo-google-fonts/chakra-petch";
import { HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold, useFonts } from "@expo-google-fonts/hanken-grotesk";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionSheetProvider, ToastProvider } from "../components/ui";
import { gameApi } from "../lib/api";
import { AuthProvider } from "../lib/auth";
// Ce module déclare la tâche GPS (TaskManager.defineTask) dès son import.
import { cleanupOrphanTracking } from "../lib/location/tracking";
import { colors, fonts } from "../theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({ HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold, ChakraPetch_600SemiBold });

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  // Un suivi GPS resté actif d'une partie terminée (crash, fermeture) est coupé.
  useEffect(() => {
    void cleanupOrphanTracking(async (gameId) => {
      const v = await gameApi.gameView(gameId);
      return v.game.phase !== "finished" && v.me.status === "active";
    });
  }, []);

  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ToastProvider>
          <ActionSheetProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.abyss },
              headerTintColor: colors.ivory,
              headerTitleStyle: { fontFamily: fonts.semibold },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.abyss },
              animation: "fade",
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="game/[id]/index" options={{ headerShown: false, gestureEnabled: false }} />
          </Stack>
          </ActionSheetProvider>
        </ToastProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
