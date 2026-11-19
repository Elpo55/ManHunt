/** Résultats : vainqueur, classement de la partie, chronologie. Positions brutes jamais affichées. */
import { TEAM_LABEL, describeEvent, formatDuration, fromView, toAppError, type GameEvent, type GameState } from "@traque/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Guard } from "../../../components/Guard";
import { Avatar, Button, Loading, Notice, Panel, Screen, SectionTitle, Stat, T, TeamTag } from "../../../components/ui";
import { gameApi } from "../../../lib/api";
import { getSupabase } from "../../../lib/supabase";
import { colors, space } from "../../../theme";

const REASON: Record<string, string> = {
  all_captured: "Tous les Fugitifs ont été capturés.",
  time_up: "Les Fugitifs ont tenu jusqu'à la fin.",
  hunters_left: "Tous les Chasseurs ont quitté la partie.",
  fugitives_left: "Tous les Fugitifs ont quitté la partie.",
  aborted: "Partie interrompue par l'hôte (non comptée).",
  no_players: "Plus aucun joueur actif.",
};

export default function Results() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [s, setS] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const v = await gameApi.gameView(id);
        setS(fromView(v));
        const { data } = await getSupabase()!
          .from("game_events")
          .select("stream,sn,type,payload,created_at")
          .eq("game_id", id)
          .in("type", ["capture", "player_status", "phase_changed", "game_finished", "zone_status"])
          .order("id", { ascending: true })
          .limit(500);
        setEvents((data ?? []).map((r) => ({ s: r.stream, sn: r.sn, t: r.type, d: r.payload, at: new Date(r.created_at).getTime() })));
      } catch (e) {
        setError(toAppError(e).message);
      }
    })();
  }, [id]);

  if (error) return <Screen><Notice tone="error">{error}</Notice></Screen>;
  if (!s) return <Loading />;
  if (s.game.phase !== "finished") {
    return (
      <Screen>
        <T>La partie n’est pas terminée.</T>
        <Button label="Retour à la partie" onPress={() => router.replace(`/game/${id}`)} />
      </Screen>
    );
  }
  const w = s.game.winner === "hunter" || s.game.winner === "fugitive" ? s.game.winner : "draw";
  const mine = s.final?.find((f) => f.u === s.me.u);
  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Résultats" }} />
        <View>
          <T v="title" color={w === "hunter" ? colors.hunter : w === "fugitive" ? colors.fugitive : colors.ivory}>
            {w === "draw" ? "Égalité" : `Victoire des ${TEAM_LABEL[w]}`}
          </T>
          <T v="small">{REASON[s.game.end_reason ?? ""] ?? ""}</T>
        </View>
        {mine ? (
          <Panel>
            <View style={{ flexDirection: "row" }}>
              <Stat label="Votre score" value={mine.score} />
              <Stat label={mine.initial_team === "hunter" ? "Captures" : "Survie"} value={mine.initial_team === "hunter" ? mine.captures : formatDuration(mine.survival_seconds)} />
              <Stat label="Distance" value={`${((mine.distance ?? 0) / 1000).toFixed(1)} km`} />
            </View>
          </Panel>
        ) : null}
        <Panel style={{ gap: space.sm }}>
          <SectionTitle>Classement</SectionTitle>
          {s.final?.map((f, i) => (
            <View key={f.u} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 }}>
              <T v="num" style={{ width: 22, fontSize: 15 }} color={colors.fog}>{i + 1}</T>
              <Avatar avatar={s.players[f.u]?.avatar} name={s.players[f.u]?.username} size={30} />
              <T style={{ flex: 1 }} numberOfLines={1}>{s.players[f.u]?.username ?? "Joueur"}</T>
              <TeamTag team={f.initial_team} />
              <T v="num" style={{ width: 52, textAlign: "right", fontSize: 15 }}>{f.score}</T>
            </View>
          ))}
        </Panel>
        {events.length ? (
          <Panel style={{ gap: space.sm }}>
            <SectionTitle>Chronologie</SectionTitle>
            {events.map((e) => {
              const line = describeEvent(e, s);
              return line ? <T key={`${e.s}:${e.sn}`} v="small" color={line.tone === "hunter" ? colors.hunter : colors.ivory}>{line.text}</T> : null;
            })}
          </Panel>
        ) : null}
        <T v="caption">Les positions GPS détaillées ne sont pas conservées : elles sont effacées 24 h après la partie.</T>
        <Button label="Retour au salon" onPress={() => router.replace(`/room/${s.view.room.id}`)} />
      </Screen>
    </Guard>
  );
}
