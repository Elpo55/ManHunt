/** Profil : succès (débloqués côté serveur), statistiques par mode, avis de modération. */
import { Feather } from "@expo/vector-icons";
import { MODE_LABEL, formatDuration, type GameMode } from "@traque/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { api, type Achievement, type ModeStats } from "../lib/api";
import { colors, space } from "../theme";
import { Notice, Panel, SectionTitle, Stat, T } from "./ui";

type Notices = Awaited<ReturnType<typeof api.myNotices>>;

export function ProgressPanels() {
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  const [stats, setStats] = useState<{ streak: number; best_streak: number; objectives: number; by_mode: Record<string, ModeStats> } | null>(null);
  const [notices, setNotices] = useState<Notices>([]);

  useFocusEffect(
    useCallback(() => {
      api.achievements().then(setAchievements).catch(() => undefined);
      api.myStats().then(setStats).catch(() => undefined);
      api
        .myNotices()
        .then((list) => setNotices(list.filter((n) => !n.revoked && (n.kind === "warning" || (n.ends_at ?? 0) > Date.now()))))
        .catch(() => undefined);
    }, []),
  );

  const unlocked = achievements?.filter((a) => a.unlocked_at).length ?? 0;
  const activeNotices = notices;

  return (
    <>
      {activeNotices.map((n) => (
        <Notice key={n.id} tone={n.kind === "suspension" ? "error" : "warn"} icon="alert-triangle">
          {n.kind === "suspension"
            ? `Compte suspendu jusqu'au ${new Date(n.ends_at ?? 0).toLocaleString("fr-FR")} : ${n.reason}`
            : `Avertissement de la modération : ${n.reason}`}
        </Notice>
      ))}

      {stats ? (
        <Panel>
          <SectionTitle>Statistiques détaillées</SectionTitle>
          <View style={{ flexDirection: "row" }}>
            <Stat label="Série en cours" value={stats.streak} />
            <Stat label="Meilleure série" value={stats.best_streak} />
            <Stat label="Balises" value={stats.objectives} />
          </View>
          {Object.entries(stats.by_mode).map(([mode, m]) => (
            <View key={mode} style={{ gap: 4, paddingTop: space.sm }}>
              <T v="heading">{MODE_LABEL[mode as GameMode] ?? mode}</T>
              <T v="small">
                {m.games} partie{m.games > 1 ? "s" : ""} · {m.wins} V / {m.losses} D / {m.draws} N · {m.captures} capture{m.captures > 1 ? "s" : ""}
                {m.as_fugitive ? ` · survie moyenne ${formatDuration(m.avg_survival_s)}` : ""}
                {m.objectives ? ` · ${m.objectives} balise(s)` : ""}
              </T>
              <T v="caption">{m.as_hunter} en Chasseur · {m.as_fugitive} en Fugitif</T>
            </View>
          ))}
          {!Object.keys(stats.by_mode).length ? <T v="small">Aucune partie comptée pour l’instant.</T> : null}
        </Panel>
      ) : null}

      {achievements ? (
        <Panel>
          <SectionTitle>{`Succès (${unlocked}/${achievements.length})`}</SectionTitle>
          {achievements.map((a) => {
            const done = !!a.unlocked_at;
            return (
              <View key={a.key} style={{ flexDirection: "row", gap: space.md, alignItems: "center", opacity: done ? 1 : 0.6 }}>
                <Feather name={done ? "award" : "lock"} size={18} color={done ? colors.volt : colors.fog2} />
                <View style={{ flex: 1 }}>
                  <T>{a.name}</T>
                  <T v="small">{a.description}</T>
                </View>
                <T v="caption">{done ? new Date(a.unlocked_at!).toLocaleDateString("fr-FR") : a.threshold > 1 ? `${Math.min(a.progress, a.threshold)}/${a.threshold}` : "—"}</T>
              </View>
            );
          })}
          <T v="caption">Purement ludiques, débloqués par le serveur à partir des parties terminées et comptées.</T>
        </Panel>
      ) : null}
    </>
  );
}
