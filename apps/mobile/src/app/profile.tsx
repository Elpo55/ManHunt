import { formatDuration, toAppError } from "@traque/shared";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Guard } from "../components/Guard";
import { ProfileForm } from "../components/ProfileForm";
import { Button, Field, Input, Notice, Panel, Screen, SectionTitle, Stat, T, TeamTag } from "../components/ui";
import { useAuth } from "../lib/auth";
import { getSupabase } from "../lib/supabase";
import { colors, space } from "../theme";

interface Row {
  game_id: string;
  initial_team: "hunter" | "fugitive";
  outcome: "win" | "loss" | "draw";
  captures: number;
  survival_seconds: number;
  distance: number;
  score: number;
  counted: boolean;
}

export default function Profile() {
  const { profile, session, linkEmail, signOut } = useAuth();
  const router = useRouter();
  const [history, setHistory] = useState<Row[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!session) return;
    getSupabase()!
      .from("game_statistics")
      .select("game_id,initial_team,outcome,captures,survival_seconds,distance,score,counted")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setHistory((data as Row[]) ?? []));
  }, [session]);

  const p = profile;
  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Profil" }} />
        {p ? (
          <>
            <Panel>
              <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.lg }}>
                <Stat label="Parties" value={p.games_played} />
                <Stat label="Victoires" value={p.wins} sub={p.games_played ? `${Math.round((100 * p.wins) / p.games_played)} %` : undefined} />
                <Stat label="Captures" value={p.captures} />
                <Stat label="Survie cumulée" value={formatDuration(p.survival_seconds)} />
              </View>
            </Panel>
            <Panel>
              <SectionTitle>Historique</SectionTitle>
              {history === null ? null : history.length === 0 ? (
                <T v="small">Vos parties terminées apparaîtront ici.</T>
              ) : (
                history.map((h) => (
                  <View key={h.game_id} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 }}>
                    <T v="small" color={h.outcome === "win" ? colors.fugitive : h.outcome === "loss" ? colors.hunter : colors.fog} style={{ width: 68 }}>
                      {h.outcome === "win" ? "Victoire" : h.outcome === "loss" ? "Défaite" : "Nul"}
                    </T>
                    <TeamTag team={h.initial_team} />
                    <T v="small" style={{ flex: 1 }} numberOfLines={1}>
                      {h.initial_team === "hunter" ? `${h.captures} capt.` : formatDuration(h.survival_seconds)} · {(h.distance / 1000).toFixed(1)} km
                    </T>
                    <T v="num" style={{ fontSize: 15 }}>{h.score}</T>
                  </View>
                ))
              )}
            </Panel>
            <Panel>
              <SectionTitle>Identité</SectionTitle>
              <ProfileForm submitLabel="Enregistrer" />
            </Panel>
            {p.is_guest ? (
              <Panel>
                <SectionTitle>Conserver ce profil</SectionTitle>
                <T v="small">Profil invité : il sera perdu si l’application est désinstallée. Liez un e-mail pour le retrouver partout.</T>
                <Field label="E-mail">
                  <Input value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
                </Field>
                <Field label="Mot de passe" hint="8 caractères minimum.">
                  <Input value={password} onChangeText={setPassword} secureTextEntry />
                </Field>
                {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
                <Button
                  label="Lier cet e-mail"
                  variant="secondary"
                  disabled={!email.includes("@") || password.length < 8}
                  onPress={async () => {
                    try {
                      await linkEmail(email.trim(), password);
                      setMsg({ tone: "info", text: "Confirmez l'adresse via le lien reçu par e-mail." });
                    } catch (e) {
                      setMsg({ tone: "error", text: toAppError(e).message });
                    }
                  }}
                />
              </Panel>
            ) : (
              <T v="small">Connecté avec {session?.user.email}</T>
            )}
            <Button
              label="Se déconnecter"
              variant="danger"
              icon="log-out"
              onPress={() =>
                Alert.alert(
                  "Se déconnecter ?",
                  p.is_guest ? "Profil invité : sans e-mail lié, il ne pourra pas être récupéré." : "Vous pourrez vous reconnecter avec votre e-mail.",
                  [
                    { text: "Annuler", style: "cancel" },
                    { text: "Se déconnecter", style: "destructive", onPress: async () => { await signOut(); router.replace("/"); } },
                  ],
                )
              }
            />
          </>
        ) : null}
      </Screen>
    </Guard>
  );
}
