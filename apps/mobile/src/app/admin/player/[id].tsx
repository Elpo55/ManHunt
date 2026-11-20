/** Fiche joueur (modération) : profil, statistiques, parties, sanctions, rôle. */
import { MODE_LABEL, formatDuration, toAppError } from "@traque/shared";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { AchievementsEditor, CorrectionsHistory, PersonalDataPanel, StatsEditor } from "../../../components/admin/PlayerAdminPanels";
import { useReason } from "../../../components/admin/ReasonModal";
import { Guard } from "../../../components/Guard";
import { Button, Loading, Notice, Panel, Screen, SectionTitle, Segmented, Stat, T, useToast } from "../../../components/ui";
import { adminApi, ROLE_LABEL, ROLE_RANK, type AdminJson, type Role } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { colors, space } from "../../../theme";

const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
const DURATIONS = [
  { value: "1", label: "1 h" },
  { value: "24", label: "24 h" },
  { value: "72", label: "3 j" },
  { value: "168", label: "7 j" },
  { value: "720", label: "30 j" },
] as const;

export default function AdminPlayer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const myRole = (profile?.role ?? "player") as Role;
  const toast = useToast();
  const { ask, modal } = useReason();
  const [d, setD] = useState<AdminJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState<(typeof DURATIONS)[number]["value"]>("24");
  const [role, setRole] = useState<Role>("player");

  const load = useCallback(() => {
    if (!id) return;
    adminApi
      .playerDetail(id)
      .then((v) => {
        setD(v);
        setRole(v.profile.role);
      })
      .catch((e) => setError(toAppError(e).message));
  }, [id]);
  useFocusEffect(load);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.push(ok, "success");
      load();
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    }
  };

  if (error) return <Screen><Notice tone="error">{error}</Notice></Screen>;
  if (!d || !id) return <Loading />;
  const p = d.profile;
  const canSanction = ROLE_RANK[myRole] > ROLE_RANK[p.role as Role] && p.id !== profile?.id;
  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: p.username ?? "Joueur" }} />
        {modal}
        <Panel>
          <T v="heading">{p.username}</T>
          <T v="caption">{`${ROLE_LABEL[p.role as Role]} · ${p.is_guest ? "invité" : "compte e-mail"} · inscrit le ${when(p.created_at)}`}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.md }}>
            <Stat label="Parties" value={p.games_played} />
            <Stat label="V / D / N" value={`${p.wins}/${p.losses}/${p.draws}`} />
            <Stat label="Captures" value={p.captures} />
            <Stat label="Survie" value={formatDuration(p.survival_seconds)} />
          </View>
          <T v="small">{`Signalements le concernant : ${d.reports_against} (dont ${d.reports_open} ouverts)`}</T>
        </Panel>

        <PersonalDataPanel profile={p} myRole={myRole} />
        {myRole === "owner" ? <StatsEditor key={JSON.stringify(p)} profile={p} onSaved={load} /> : null}
        {myRole === "owner" ? <AchievementsEditor userId={p.id} achievements={d.achievements ?? []} onSaved={load} /> : null}
        <CorrectionsHistory corrections={d.corrections ?? []} />

        {canSanction ? (
          <Panel>
            <SectionTitle>Sanctions</SectionTitle>
            <Button
              label="Avertir"
              small
              variant="secondary"
              icon="alert-triangle"
              onPress={async () => {
                const r = await ask({ title: `Avertir ${p.username}`, message: "Le joueur verra ce motif dans son profil." });
                if (r) await run(() => adminApi.warn(p.id, r), "Avertissement enregistré.");
              }}
            />
            <Segmented value={hours} onChange={setHours} options={DURATIONS.filter((x) => myRole !== "moderator" || Number(x.value) <= 72).map((x) => ({ value: x.value, label: x.label }))} />
            <Button
              label="Suspendre temporairement"
              small
              variant="danger"
              icon="slash"
              onPress={async () => {
                const r = await ask({ title: `Suspendre ${p.username}`, message: "Le joueur ne pourra plus créer ni rejoindre de salon pendant cette durée.", confirm: "Suspendre", destructive: true });
                if (r) await run(() => adminApi.suspend(p.id, Number(hours), r), "Suspension enregistrée.");
              }}
            />
          </Panel>
        ) : (
          <Notice>Ce compte a un rôle égal ou supérieur au vôtre : aucune sanction possible.</Notice>
        )}

        {myRole === "owner" && p.id !== profile?.id ? (
          <Panel>
            <SectionTitle>Rôle (propriétaire uniquement)</SectionTitle>
            <Segmented value={role} onChange={setRole} options={[{ value: "player", label: "Joueur" }, { value: "moderator", label: "Modérateur" }, { value: "admin", label: "Admin" }]} />
            <Button
              label="Appliquer le rôle"
              small
              disabled={role === p.role}
              onPress={async () => {
                const r = await ask({ title: `${p.username} → ${ROLE_LABEL[role]}`, message: "Le changement est journalisé." });
                if (r) await run(() => adminApi.setRole(p.id, role, r), "Rôle modifié.");
              }}
            />
          </Panel>
        ) : null}

        <Panel>
          <SectionTitle>Historique des sanctions</SectionTitle>
          {(d.sanctions as AdminJson[]).map((s) => (
            <View key={s.id} style={{ gap: 2 }}>
              <T color={s.revoked_at ? colors.fog : s.kind === "suspension" ? colors.danger : colors.warn}>
                {`${s.kind === "suspension" ? `Suspension jusqu'au ${when(s.ends_at)}` : "Avertissement"} · par ${s.by ?? "?"} · ${when(s.starts_at)}`}
              </T>
              <T v="small">{s.reason}</T>
              {s.revoked_at ? (
                <T v="caption">{`Levée le ${when(s.revoked_at)} : ${s.revoke_reason}`}</T>
              ) : canSanction ? (
                <Button
                  label="Lever"
                  small
                  variant="ghost"
                  onPress={async () => {
                    const r = await ask({ title: "Lever la sanction", confirm: "Lever" });
                    if (r) await run(() => adminApi.revokeSanction(s.id, r), "Sanction levée.");
                  }}
                />
              ) : null}
            </View>
          ))}
          {!(d.sanctions as AdminJson[]).length ? <T v="small">Aucune sanction.</T> : null}
        </Panel>

        <Panel>
          <SectionTitle>Dernières parties</SectionTitle>
          {(d.games as AdminJson[]).map((g) => (
            <T key={g.game_id} v="small" color={colors.ivory}>
              {`${when(g.at)} · ${MODE_LABEL[g.mode as keyof typeof MODE_LABEL] ?? g.mode} · ${g.team === "hunter" ? "Chasseur" : "Fugitif"} · ${g.outcome} · ${g.score} pts${g.counted ? "" : " (non comptée)"}`}
            </T>
          ))}
          {!(d.games as AdminJson[]).length ? <T v="small">Aucune partie.</T> : null}
        </Panel>
      </Screen>
    </Guard>
  );
}
