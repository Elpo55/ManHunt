/**
 * Fiche partie (administration) : participants, équipes, paramètres résumés,
 * interventions. AUCUNE position n'est accessible. Pause / reprise /
 * terminaison sont annoncées à tous les joueurs et journalisées ; une partie
 * terminée par l'administration n'est pas comptée (aucun résultat modifié).
 */
import { MODE_LABEL, PHASE_LABEL, formatDuration, toAppError } from "@traque/shared";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useReason } from "../../../components/admin/ReasonModal";
import { Guard } from "../../../components/Guard";
import { Button, Loading, Notice, Panel, Screen, SectionTitle, T, TeamTag, useToast } from "../../../components/ui";
import { adminApi, ROLE_RANK, type AdminJson, type Role } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { colors, space } from "../../../theme";

const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");

export default function AdminGame() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const isAdmin = ROLE_RANK[(profile?.role ?? "player") as Role] >= ROLE_RANK.admin;
  const toast = useToast();
  const { ask, modal } = useReason();
  const [d, setD] = useState<AdminJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!id) return;
    adminApi.gameDetail(id).then(setD).catch((e) => setError(toAppError(e).message));
  }, [id]);
  useFocusEffect(load);

  const act = async (title: string, fn: (reason: string) => Promise<unknown>, ok: string, destructive = false) => {
    const reason = await ask({ title, message: "Tous les joueurs de la partie verront cette intervention et son motif.", destructive });
    if (!reason) return;
    try {
      await fn(reason);
      toast.push(ok, "success");
      load();
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    }
  };

  if (error) return <Screen><Notice tone="error">{error}</Notice></Screen>;
  if (!d || !id) return <Loading />;
  const g = d.game;
  const c = g.config;
  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Partie" }} />
        {modal}
        <Panel>
          <T v="heading">{`${MODE_LABEL[g.mode as keyof typeof MODE_LABEL] ?? g.mode} · ${PHASE_LABEL[g.phase as keyof typeof PHASE_LABEL] ?? g.phase}`}</T>
          <T v="small">{`Début ${when(g.started_at)} · fin prévue ${when(g.phase_ends_at)}${g.winner ? ` · vainqueur : ${g.winner} (${g.end_reason})` : ""}`}</T>
          <T v="small">
            {`Zone « ${c.zone?.label} » (${c.zone?.shape === "polygon" ? "polygone" : `${c.zone?.radius_m} m`}, ${c.zone?.forbidden ?? 0} zone(s) interdite(s)) · ${formatDuration(c.duration_s)} · capture ${c.capture_method} · ${c.objectives?.enabled ? `${c.objectives.beacons} balise(s)` : "sans objectifs"}`}
          </T>
          <T v="caption">Les positions des joueurs ne sont jamais accessibles à l’administration.</T>
        </Panel>
        {isAdmin && g.phase !== "finished" ? (
          <Panel>
            <SectionTitle>Interventions (annoncées et journalisées)</SectionTitle>
            {g.phase === "paused" ? (
              <Button label="Reprendre la partie" small variant="secondary" onPress={() => void act("Reprendre la partie", (r) => adminApi.resumeGame(id, r), "Partie reprise.")} />
            ) : (
              <Button label="Mettre en pause" small variant="secondary" onPress={() => void act("Mettre la partie en pause", (r) => adminApi.pauseGame(id, r), "Partie en pause.")} />
            )}
            <Button label="Terminer la partie (non comptée)" small variant="danger" onPress={() => void act("Terminer la partie", (r) => adminApi.endGame(id, r), "Partie terminée.", true)} />
          </Panel>
        ) : null}
        <Panel>
          <SectionTitle>{`Participants (${(d.players as AdminJson[]).length})`}</SectionTitle>
          {(d.players as AdminJson[]).map((p) => (
            <View key={p.u} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <T style={{ flex: 1 }}>{p.username}</T>
              <T v="caption" color={p.connected ? colors.fog : colors.warn}>{`${p.status}${p.connected ? "" : " · déconnecté"} · ${when(p.last_seen_at)}`}</T>
              <TeamTag team={p.team} />
            </View>
          ))}
        </Panel>
        <Panel>
          <SectionTitle>Interventions passées</SectionTitle>
          {(d.admin_events as AdminJson[]).map((e, i) => (
            <T key={i} v="small">{`${when(e.at)} · ${e.action} par ${e.by ?? "?"} : ${e.reason}`}</T>
          ))}
          {!(d.admin_events as AdminJson[]).length ? <T v="small">Aucune.</T> : null}
        </Panel>
      </Screen>
    </Guard>
  );
}
