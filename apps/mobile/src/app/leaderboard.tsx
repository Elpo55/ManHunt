import { toAppError } from "@traque/shared";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Guard } from "../components/Guard";
import { Avatar, Loading, Notice, Panel, Screen, T } from "../components/ui";
import { api, type LeaderboardRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { colors, space } from "../theme";

export default function Leaderboard() {
  const { session } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (session) api.leaderboard(null).then(setRows).catch((e) => setError(toAppError(e).message));
  }, [session]);
  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Classement" }} />
        <T v="small">Classement privé de cette instance, par victoires puis score.</T>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!rows && !error ? <Loading /> : null}
        {rows && rows.length === 0 ? <T v="small">Le classement se remplira après les premières parties.</T> : null}
        {rows && rows.length ? (
          <Panel style={{ padding: 0, gap: 0 }}>
            {rows.map((r, i) => (
              <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, backgroundColor: r.id === session?.user.id ? colors.voltSoft : undefined }}>
                <T v="num" style={{ width: 28, fontSize: 16, textAlign: "center" }} color={i < 3 ? colors.ivory : colors.fog}>{i + 1}</T>
                <Avatar avatar={r.avatar} name={r.username} size={34} />
                <View style={{ flex: 1 }}>
                  <T numberOfLines={1}>{r.username}</T>
                  <T v="caption">{r.games_played} parties · {r.win_rate} % · {r.captures} captures</T>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <T v="num" style={{ fontSize: 16 }}>{r.wins}</T>
                  <T v="caption">{r.total_score} pts</T>
                </View>
              </View>
            ))}
          </Panel>
        ) : null}
      </Screen>
    </Guard>
  );
}
