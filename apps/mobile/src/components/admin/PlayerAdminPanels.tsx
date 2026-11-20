/**
 * Fiche joueur — panneaux v0.5.0 :
 *  - données personnelles (minimisation RGPD : e-mail masqué, affichage complet
 *    motivé et journalisé, réservé aux administrateurs) ;
 *  - correction des statistiques et des succès (propriétaire uniquement,
 *    motif obligatoire, journal avant/après, joueur informé).
 * Le serveur revérifie tout (rôle, valeurs, cohérence).
 */
import { formatDuration, toAppError } from "@traque/shared";
import { useState } from "react";
import { View } from "react-native";
import { adminApi, ROLE_RANK, type AdminJson, type Role } from "../../lib/api";
import { colors, space } from "../../theme";
import { Button, Input, Panel, SectionTitle, T, Toggle, useToast } from "../ui";
import { useReason } from "./ReasonModal";

const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");

const FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "games_played", label: "Parties jouées" },
  { key: "wins", label: "Victoires" },
  { key: "losses", label: "Défaites" },
  { key: "draws", label: "Égalités" },
  { key: "captures", label: "Captures" },
  { key: "times_captured", label: "Fois capturé" },
  { key: "survival_seconds", label: "Survie cumulée (s)", hint: "en secondes" },
  { key: "total_score", label: "Score total" },
  { key: "objectives_total", label: "Balises atteintes" },
  { key: "win_streak", label: "Série en cours" },
  { key: "best_streak", label: "Meilleure série" },
];

export function PersonalDataPanel({ profile, myRole }: { profile: AdminJson; myRole: Role }) {
  const toast = useToast();
  const { ask, modal } = useReason();
  const [email, setEmail] = useState<string | null>(null);
  return (
    <Panel>
      {modal}
      <SectionTitle>Données personnelles</SectionTitle>
      <T v="small">{`Compte ${profile.is_guest ? "invité (aucun e-mail)" : "e-mail"} · inscrit le ${when(profile.created_at)} · dernière activité ${when(profile.last_seen_at)}`}</T>
      {!profile.is_guest ? (
        <T v="small">{`E-mail : ${email ?? profile.email_masked ?? "—"}${profile.email_confirmed ? " (vérifié)" : " (non vérifié)"}`}</T>
      ) : null}
      {!profile.is_guest && !email && ROLE_RANK[myRole] >= ROLE_RANK.admin ? (
        <Button
          label="Afficher l'e-mail complet"
          small
          variant="ghost"
          icon="eye"
          onPress={async () => {
            const reason = await ask({ title: "Afficher l'e-mail", message: "Réservé au support (compte bloqué, demande du joueur…). L'affichage est journalisé." });
            if (!reason) return;
            try {
              setEmail(await adminApi.revealEmail(profile.id, reason));
            } catch (e) {
              toast.push(toAppError(e).message, "error");
            }
          }}
        />
      ) : null}
      <T v="caption">Mots de passe et positions GPS ne sont jamais accessibles à l’administration.</T>
    </Panel>
  );
}

export function StatsEditor({ profile, onSaved }: { profile: AdminJson; onSaved: () => void }) {
  const toast = useToast();
  const { ask, modal } = useReason();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, String(profile[f.key] ?? 0)])));
  const changes = Object.fromEntries(
    FIELDS.filter((f) => draft[f.key] !== String(profile[f.key] ?? 0) && /^\d+$/.test(draft[f.key])).map((f) => [f.key, Number(draft[f.key])]),
  );
  const invalid = FIELDS.some((f) => !/^\d+$/.test(draft[f.key]));
  const n = (k: string) => Number(draft[k] || 0);
  const incoherent = n("wins") + n("losses") + n("draws") > n("games_played") || n("win_streak") > n("best_streak") || n("best_streak") > n("wins");
  return (
    <Panel>
      {modal}
      <SectionTitle>Corriger les statistiques (propriétaire)</SectionTitle>
      <T v="small">Le motif et les valeurs avant / après sont enregistrés dans le journal ; le joueur est informé dans son profil.</T>
      {FIELDS.map((f) => (
        <View key={f.key} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <T style={{ flex: 1 }} color={changes[f.key] !== undefined ? colors.volt : colors.ivory}>{f.label}</T>
          <Input
            value={draft[f.key]}
            onChangeText={(t) => setDraft({ ...draft, [f.key]: t.replace(/\D/g, "").slice(0, 10) })}
            keyboardType="number-pad"
            style={{ width: 120, textAlign: "right", minHeight: 40 }}
            accessibilityLabel={f.label}
          />
        </View>
      ))}
      <T v="caption">{`Survie : ${formatDuration(n("survival_seconds"))}`}</T>
      {incoherent ? <T v="small" color={colors.warn}>Incohérent : victoires + défaites + égalités ≤ parties, série en cours ≤ meilleure série ≤ victoires.</T> : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Annuler" small variant="ghost" style={{ flex: 1 }} onPress={() => setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(profile[f.key] ?? 0)])))} />
        <Button
          label={`Enregistrer (${Object.keys(changes).length})`}
          small
          style={{ flex: 2 }}
          disabled={invalid || incoherent || !Object.keys(changes).length}
          onPress={async () => {
            const summary = Object.entries(changes).map(([k, v]) => `${FIELDS.find((f) => f.key === k)?.label} : ${profile[k]} → ${v}`).join("\n");
            const reason = await ask({ title: "Corriger les statistiques", message: summary, confirm: "Corriger" });
            if (!reason) return;
            try {
              await adminApi.correctStats(profile.id, changes, reason);
              toast.push("Statistiques corrigées.", "success");
              onSaved();
            } catch (e) {
              toast.push(toAppError(e).message, "error");
            }
          }}
        />
      </View>
    </Panel>
  );
}

export function AchievementsEditor({ userId, achievements, onSaved }: { userId: string; achievements: AdminJson[]; onSaved: () => void }) {
  const toast = useToast();
  const { ask, modal } = useReason();
  return (
    <Panel>
      {modal}
      <SectionTitle>Succès (propriétaire)</SectionTitle>
      {achievements.map((a) => (
        <Toggle
          key={a.key}
          label={a.name}
          description={a.unlocked_at ? `Débloqué le ${when(a.unlocked_at)}` : "Non débloqué"}
          value={!!a.unlocked_at}
          onChange={async (v) => {
            const reason = await ask({ title: `${v ? "Attribuer" : "Retirer"} « ${a.name} »`, confirm: v ? "Attribuer" : "Retirer", destructive: !v });
            if (!reason) return;
            try {
              await adminApi.setAchievement(userId, a.key, v, reason);
              toast.push(v ? "Succès attribué." : "Succès retiré.", "success");
              onSaved();
            } catch (e) {
              toast.push(toAppError(e).message, "error");
            }
          }}
        />
      ))}
    </Panel>
  );
}

export function CorrectionsHistory({ corrections }: { corrections: AdminJson[] }) {
  if (!corrections.length) return null;
  return (
    <Panel>
      <SectionTitle>Historique des corrections</SectionTitle>
      {corrections.map((c, i) => (
        <View key={i} style={{ gap: 2 }}>
          <T v="small" color={colors.ivory}>{`${when(c.at)} · ${c.by ?? "?"} · ${c.reason}`}</T>
          <T v="caption">
            {c.action === "correct_stats"
              ? Object.keys(c.result?.after ?? {}).map((k) => `${k} ${c.result.before[k]} → ${c.result.after[k]}`).join(" · ")
              : `Succès ${c.result?.key} : ${c.result?.after ? "attribué" : "retiré"}`}
          </T>
        </View>
      ))}
    </Panel>
  );
}
