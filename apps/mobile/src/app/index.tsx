/** Accueil : présentation (hors connexion) ou tableau de bord (salons). */
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProfileError } from "../components/Guard";
import { Avatar, Button, IconButton, Loading, Notice, Panel, Screen, T } from "../components/ui";
import { api, type MyRoom } from "../lib/api";
import { useAuth } from "../lib/auth";
import { APP_NAME } from "../lib/env";
import { colors, radius, space } from "../theme";
import { toAppError } from "@traque/shared";

const STATUS: Record<string, string> = { lobby: "En attente", playing: "Partie en cours", results: "Résultats" };

function Welcome() {
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.abyss }}>
      <View style={{ flex: 1, padding: space.xl, justifyContent: "flex-end", gap: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Feather name="crosshair" size={22} color={colors.volt} />
          <T v="heading">{APP_NAME}</T>
        </View>
        <T v="title" style={{ fontSize: 34, lineHeight: 39 }}>
          Une traque grandeur nature, entre amis, sur une vraie carte.
        </T>
        <T v="body" color={colors.fog}>
          Chasseurs et Fugitifs se déplacent réellement. Chacun voit les autres de façon approximative, le radar affine la poursuite, la capture se fait par proximité.
        </T>
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Button label="Commencer" onPress={() => router.push("/login")} />
          <Button label="J'ai un code de salon" variant="secondary" onPress={() => router.push("/join")} />
        </View>
        <T v="caption" style={{ textAlign: "center" }}>
          Votre position n’est partagée que pendant une partie, avec votre accord.
        </T>
      </View>
    </SafeAreaView>
  );
}

function Dashboard() {
  const router = useRouter();
  const { profile } = useAuth();
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api.myRooms().then(setRooms).catch((e) => setError(toAppError(e).message));
    }, []),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.abyss }} edges={["top"]}>
      <Screen>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable onPress={() => router.push("/profile")} style={{ flexDirection: "row", alignItems: "center", gap: space.md }} accessibilityRole="button" accessibilityLabel="Mon profil">
            <Avatar avatar={profile?.avatar} name={profile?.username} size={44} />
            <View>
              <T v="caption">Bonjour</T>
              <T v="heading">{profile?.username}</T>
            </View>
          </Pressable>
          <View style={{ flexDirection: "row" }}>
            <IconButton icon="award" label="Classement" onPress={() => router.push("/leaderboard")} />
            <IconButton icon="settings" label="Réglages" onPress={() => router.push("/settings")} />
          </View>
        </View>

        <Pressable onPress={() => router.push("/rooms/new")} style={({ pressed }) => [{ backgroundColor: colors.volt, borderRadius: radius.panel, padding: space.xl, gap: space.xl, opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button" accessibilityLabel="Créer un salon">
          <Feather name="plus" size={24} color="#fff" />
          <View>
            <T v="heading" color="#fff">Créer un salon</T>
            <T v="small" color="rgba(255,255,255,0.8)">Vous choisissez la zone et les règles.</T>
          </View>
        </Pressable>
        <Pressable onPress={() => router.push("/join")} style={({ pressed }) => [{ backgroundColor: colors.graphite, borderRadius: radius.panel, padding: space.xl, gap: space.xl, opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button" accessibilityLabel="Rejoindre un salon">
          <Feather name="log-in" size={24} color={colors.fog} />
          <View>
            <T v="heading">Rejoindre un salon</T>
            <T v="small">Avec le code à 6 caractères.</T>
          </View>
        </Pressable>

        <T v="heading">Vos salons</T>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {rooms === null && !error ? <Loading /> : null}
        {rooms && rooms.length === 0 ? <T v="small">Aucun salon pour l’instant.</T> : null}
        {rooms && rooms.length > 0 ? (
          <Panel style={{ padding: 0, gap: 0 }}>
            {rooms.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(r.status === "playing" && r.current_game_id ? `/game/${r.current_game_id}` : `/room/${r.id}`)}
                style={({ pressed }) => [{ padding: space.lg, flexDirection: "row", alignItems: "center", gap: space.md }, pressed && { backgroundColor: colors.slate }]}
                accessibilityRole="button"
              >
                <View style={{ flex: 1 }}>
                  <T numberOfLines={1}>{r.name}</T>
                  <T v="small">
                    {r.code} · {r.members} joueur{r.members > 1 ? "s" : ""}
                    {r.is_host ? " · hôte" : ""}
                  </T>
                </View>
                <T v="caption" color={r.status === "playing" ? colors.volt : colors.fog}>{STATUS[r.status] ?? r.status}</T>
                <Feather name="chevron-right" size={18} color={colors.fog2} />
              </Pressable>
            ))}
          </Panel>
        ) : null}
      </Screen>
    </SafeAreaView>
  );
}

export default function Home() {
  const { configured, ready, session, profile, profileError } = useAuth();
  if (configured && !ready) return <Loading label="Connexion au serveur" />;
  if (!configured || !session) return <Welcome />;
  if (!profile) return profileError ? <ProfileError /> : <Loading label="Chargement du profil" />;
  if (!profile.username) return <OnboardingRedirect />;
  return <Dashboard />;
}

function OnboardingRedirect() {
  const router = useRouter();
  useFocusEffect(useCallback(() => router.replace("/onboarding"), [router]));
  return <Loading />;
}
