/**
 * Lobby : invitation, joueurs (présence, équipe, accord), consignes de
 * sécurité et consentement explicite au partage de position, lancement.
 */
import { Feather } from "@expo/vector-icons";
import { SAFETY_RULES, formatDuration, formatMeters, toAppError, type Team } from "@traque/shared";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Share, View } from "react-native";
import { Guard } from "../../../components/Guard";
import { Avatar, Button, Loading, Notice, Panel, Screen, SectionTitle, Segmented, T, TeamTag, Toggle, useActionSheet, useToast, type SheetAction } from "../../../components/ui";
import { api, type RoomMember, type RoomState } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useLocationPermissions } from "../../../lib/location/permissions";
import { useRoom } from "../../../lib/realtime/useRoom";
import { colors, space } from "../../../theme";

function blockers(s: RoomState): string[] {
  const m = s.members;
  const out: string[] = [];
  if (!s.room.config.zone.set) out.push("Zone de jeu non choisie.");
  if (m.length < 2) out.push("Il faut au moins 2 joueurs.");
  const noTeam = m.filter((x) => !x.team).length;
  if (noTeam) out.push(`${noTeam} joueur(s) sans équipe.`);
  if (m.length >= 2 && !m.some((x) => x.team === "hunter")) out.push("Aucun Chasseur.");
  if (m.length >= 2 && !m.some((x) => x.team === "fugitive")) out.push("Aucun Fugitif.");
  const noConsent = m.filter((x) => !x.location_consent).length;
  if (noConsent) out.push(`${noConsent} joueur(s) n'ont pas encore accepté les consignes.`);
  return out;
}

export default function Lobby() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const router = useRouter();
  const toast = useToast();
  const sheetMenu = useActionSheet();
  const room = useRoom(id ?? null, userId);
  const perms = useLocationPermissions();
  const [busy, setBusy] = useState<string | null>(null);

  const s = room.state;
  // Redirection automatique des participants au lancement.
  const gameId = s?.room.status === "playing" && s.game?.participant ? s.game.id : null;
  useEffect(() => {
    if (gameId && room.lastEvent?.t === "game_started") router.replace(`/game/${gameId}`);
  }, [gameId, room.lastEvent, router]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.push(ok, "success");
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    } finally {
      setBusy(null);
    }
  };

  if (room.error && (!s || ["E_NOT_MEMBER", "E_ROOM_NOT_FOUND"].includes(room.error.code))) {
    return (
      <Screen>
        <Notice tone="error">{room.error.message}</Notice>
        <Button label="Accueil" onPress={() => router.replace("/")} />
      </Screen>
    );
  }
  if (!s || !userId) return <Loading label="Chargement du salon" />;

  const me = s.members.find((m) => m.user_id === userId);
  const isHost = s.room.host_id === userId;
  const cfg = s.room.config;
  const lobby = s.room.status === "lobby";
  const block = blockers(s);
  const fgGranted = perms.state.foreground === "granted";

  const invite = async () => {
    const link = `traque://join?code=${s.room.code}`;
    await Share.share({ message: `Rejoins ma partie « ${s.room.name} » : code ${s.room.code}\n${link}` }).catch(() => undefined);
  };

  const memberMenu = (m: RoomMember) => {
    if (!isHost || m.user_id === userId) return;
    const setTeam = (t: Team | null) => run("team", () => api.setMemberTeam(s.room.id, m.user_id, t));
    const actions: SheetAction[] = [
      ...(lobby
        ? [
            { label: "Chasseur", icon: "crosshair" as const, onPress: () => setTeam("hunter") },
            { label: "Fugitif", icon: "wind" as const, onPress: () => setTeam("fugitive") },
            { label: "Sans équipe", icon: "help-circle" as const, onPress: () => setTeam(null) },
          ]
        : []),
      { label: "Transmettre le rôle d'hôte", icon: "star", onPress: () => run("host", () => api.transferHost(s.room.id, m.user_id), `${m.username} est l'hôte.`) },
      {
        label: "Exclure du salon",
        icon: "user-x",
        tone: "destructive",
        onPress: () =>
          Alert.alert("Exclure ?", "Le joueur pourra revenir avec le code, sauf si vous l'interdisez.", [
            { text: "Annuler", style: "cancel" },
            { text: "Exclure", onPress: () => run("kick", () => api.kick(s.room.id, m.user_id, false)) },
            { text: "Exclure et interdire", style: "destructive", onPress: () => run("kick", () => api.kick(s.room.id, m.user_id, true)) },
          ]),
      },
    ];
    sheetMenu.show({ title: m.username, actions });
  };

  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: s.room.name }} />

        {s.room.status === "playing" && s.game ? (
          <Notice icon="radio">
            {s.game.participant ? "Une partie est en cours." : "Une partie est en cours : vous jouerez la suivante."}
          </Notice>
        ) : null}
        {s.room.status === "playing" && s.game?.participant ? <Button label="Reprendre la partie" onPress={() => router.replace(`/game/${s.game!.id}`)} /> : null}
        {s.room.status === "results" && s.game ? (
          <Panel>
            <T>La partie est terminée.</T>
            <Button label="Voir les résultats" variant="secondary" onPress={() => router.push(`/game/${s.game!.id}/results`)} />
            {isHost ? <Button label="Nouvelle partie" loading={busy === "lobby"} onPress={() => run("lobby", () => api.returnToLobby(s.room.id))} /> : null}
          </Panel>
        ) : null}

        <Panel>
          <T v="caption">Code d’invitation</T>
          <Pressable
            onPress={async () => {
              await Clipboard.setStringAsync(s.room.code);
              toast.push("Code copié.", "success");
            }}
            accessibilityRole="button"
            accessibilityLabel={`Copier le code ${s.room.code}`}
          >
            <T v="numLarge" style={{ letterSpacing: 6 }}>{s.room.code}</T>
          </Pressable>
          <Button label="Inviter des amis" icon="share-2" variant="secondary" onPress={invite} />
        </Panel>

        <Panel>
          <SectionTitle right={isHost && lobby ? <Button label="Modifier" small variant="ghost" icon="sliders" onPress={() => router.push(`/room/${s.room.id}/config`)} /> : null}>
            Règles
          </SectionTitle>
          <T v="small">
            {cfg.zone.set ? `${cfg.zone.label} · rayon ${formatMeters(cfg.zone.radius_m)}` : "Zone non choisie"}
            {"\n"}
            {formatDuration(cfg.duration_s)} · capture à {cfg.capture_radius_m} m · adversaires {cfg.enemy_reveal === "live" ? `toutes les ${cfg.enemy_refresh_s} s` : "par impulsions"} (≈ {cfg.approx_m} m)
          </T>
          {!isHost ? <Button label="Voir la zone et les règles" small variant="ghost" onPress={() => router.push(`/room/${s.room.id}/config`)} /> : null}
        </Panel>

        {me && lobby ? (
          <Panel>
            <SectionTitle>Votre participation</SectionTitle>
            {s.room.allow_team_choice || isHost ? (
              <Segmented
                value={(me.team ?? "none") as Team | "none"}
                onChange={(v) =>
                  run("team", () => (isHost ? api.setMemberTeam(s.room.id, userId, v === "none" ? null : v) : api.chooseTeam(s.room.id, v === "none" ? null : v)))
                }
                options={[
                  { value: "hunter", label: "Chasseur" },
                  { value: "fugitive", label: "Fugitif" },
                  { value: "none", label: "Indécis" },
                ]}
              />
            ) : (
              <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
                <T v="small">L’hôte répartit les équipes. Vous êtes :</T>
                <TeamTag team={me.team} />
              </View>
            )}
            <View style={{ gap: space.sm, paddingTop: space.sm }}>
              <T v="heading">Consignes de sécurité</T>
              {SAFETY_RULES.map((r) => (
                <View key={r} style={{ flexDirection: "row", gap: space.sm }}>
                  <Feather name="check" size={16} color={colors.fog} style={{ marginTop: 3 }} />
                  <T v="small" color={colors.ivory} style={{ flex: 1 }}>{r}</T>
                </View>
              ))}
            </View>
            <Toggle
              label="J'accepte ces consignes et le partage de ma position pendant cette partie"
              description="Obligatoire pour jouer. Vous pourrez arrêter le partage à tout moment."
              value={me.location_consent}
              onChange={(v) => run("consent", () => api.setConsent(s.room.id, v))}
            />
            {me.location_consent && !fgGranted ? (
              <Notice tone="warn" icon="map-pin">
                <T v="small" color={colors.ivory}>La localisation n’est pas autorisée sur ce téléphone.</T>
                <Button label="Autoriser la localisation" small variant="secondary" onPress={() => router.push("/permissions")} style={{ marginTop: space.sm }} />
              </Notice>
            ) : null}
            <Toggle label="Je suis prêt" value={me.is_ready} onChange={(v) => run("ready", () => api.setReady(s.room.id, v))} />
          </Panel>
        ) : null}

        <Panel style={{ paddingHorizontal: 0, gap: 0 }}>
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <SectionTitle right={isHost && lobby && s.members.length >= 2 ? <Button label="Répartir" small variant="ghost" icon="shuffle" onPress={() => run("auto", () => api.autoAssign(s.room.id), "Équipes réparties.")} /> : null}>
              {`Joueurs (${s.members.length}/${s.room.max_players})`}
            </SectionTitle>
          </View>
          {s.members.map((m) => (
            <Pressable
              key={m.user_id}
              onPress={() => memberMenu(m)}
              disabled={!isHost || m.user_id === userId}
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md }, pressed && { backgroundColor: colors.slate }]}
              accessibilityRole={isHost ? "button" : undefined}
              accessibilityLabel={`${m.username}${m.is_host ? ", hôte" : ""}`}
            >
              <View>
                <Avatar avatar={m.avatar} name={m.username} />
                <View style={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: colors.graphite, backgroundColor: room.online.has(m.user_id) ? colors.fugitive : colors.fog2 }} />
              </View>
              <View style={{ flex: 1 }}>
                <T numberOfLines={1}>
                  {m.username}
                  {m.user_id === userId ? " (vous)" : ""}
                  {m.is_host ? "  ★" : ""}
                </T>
                <T v="caption" color={m.location_consent ? colors.fugitive : colors.warn}>
                  {m.location_consent ? "Consignes acceptées" : "Accord en attente"}
                  {m.is_ready ? " · prêt" : ""}
                </T>
              </View>
              <TeamTag team={m.team} />
            </Pressable>
          ))}
        </Panel>

        {isHost && lobby ? (
          <View style={{ gap: space.sm }}>
            {block.length ? <Notice tone="warn">{block.join(" ")}</Notice> : null}
            <Button
              label="Lancer la partie"
              icon="play"
              disabled={block.length > 0}
              loading={busy === "start"}
              onPress={() =>
                run("start", async () => {
                  const r = await api.startGame(s.room.id);
                  router.replace(`/game/${r.game_id}`);
                })
              }
            />
          </View>
        ) : lobby ? (
          <T v="small" style={{ textAlign: "center" }}>En attente du lancement par l’hôte.</T>
        ) : null}

        <Button
          label="Quitter le salon"
          variant="ghost"
          icon="log-out"
          onPress={() =>
            Alert.alert("Quitter le salon ?", s.room.status === "playing" ? "Une partie est en cours : vous serez compté comme ayant abandonné." : undefined, [
              { text: "Rester", style: "cancel" },
              { text: "Quitter", style: "destructive", onPress: () => run("leave", async () => { await api.leaveRoom(s.room.id); router.replace("/"); }) },
            ])
          }
        />
      </Screen>
    </Guard>
  );
}
