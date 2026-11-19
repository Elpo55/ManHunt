/**
 * Tableau de bord d'administration (modérateur et plus).
 * L'interface n'est qu'un raccourci : chaque action est revérifiée par le
 * serveur (rôle requis), exige un motif et est journalisée. Aucune action ne
 * permet de voir ou modifier une position, de capturer ou de changer un résultat.
 */
import { MODE_LABEL, PHASE_LABEL, formatDuration, normalizeConfig, toAppError } from "@traque/shared";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useReason } from "../../components/admin/ReasonModal";
import { Guard } from "../../components/Guard";
import { Button, Field, Input, Loading, Notice, Panel, Screen, SectionTitle, Segmented, Stat, Stepper, T, Toggle, useToast } from "../../components/ui";
import { adminApi, api, ROLE_LABEL, ROLE_RANK, type AdminJson, type Role } from "../../lib/api";
import { loadAppSettings } from "../../lib/appSettings";
import { useAuth } from "../../lib/auth";
import { APP_VERSION } from "../../lib/env";
import { colors, radius, space } from "../../theme";

type Tab = "overview" | "players" | "games" | "reports" | "settings" | "audit";
const TABS: { id: Tab; label: string; min: Role }[] = [
  { id: "overview", label: "Vue générale", min: "moderator" },
  { id: "players", label: "Joueurs", min: "moderator" },
  { id: "games", label: "Parties", min: "moderator" },
  { id: "reports", label: "Signalements", min: "moderator" },
  { id: "settings", label: "Réglages", min: "admin" },
  { id: "audit", label: "Journal", min: "moderator" },
];
const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");

function useRun() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.push(ok, "success");
      return true;
    } catch (e) {
      toast.push(toAppError(e).message, "error");
      return false;
    }
  };
}

function Overview({ role }: { role: Role }) {
  const [o, setO] = useState<AdminJson | null>(null);
  const [usage, setUsage] = useState<AdminJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  const load = useCallback(() => {
    adminApi.overview().then(setO).catch((e) => setError(toAppError(e).message));
    if (ROLE_RANK[role] >= ROLE_RANK.admin) api.usageStats().then(setUsage).catch(() => undefined);
  }, [role]);
  useFocusEffect(load);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!o) return <Loading />;
  const cron = (o.cron ?? []) as AdminJson[];
  return (
    <>
      <Panel>
        <SectionTitle right={<Button label="Actualiser" small variant="ghost" icon="refresh-cw" onPress={load} />}>Activité</SectionTitle>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.lg }}>
          <Stat label="Joueurs inscrits" value={o.players_total} />
          <Stat label="Connectés (2 min)" value={o.players_online} />
          <Stat label="Parties en cours" value={o.games_live} />
          <Stat label="Salons actifs (24 h)" value={o.rooms_active} />
          <Stat label="Parties (7 j)" value={o.games_finished_7d} />
          <Stat label="Signalements ouverts" value={o.reports_open} />
          <Stat label="Suspensions actives" value={o.suspensions_active} />
          <Stat label="Erreurs (24 h)" value={o.errors_24h} />
        </View>
      </Panel>
      <Panel>
        <SectionTitle>État du backend</SectionTitle>
        <T v="small">{`Serveur joignable · horloge ${when(o.server_now)} · base ${(o.database_bytes / 1048576).toFixed(1)} Mo / ~500 Mo gratuits`}</T>
        <T v="small">{o.realtime_messages_10min == null ? "Temps réel : mesure indisponible." : `Temps réel : ${o.realtime_messages_10min} messages sur les 10 dernières minutes.`}</T>
        {cron.length ? (
          cron.map((c) => (
            <T key={c.job} v="small" color={c.status === "failed" ? colors.danger : colors.fog}>
              {`Tâche ${c.job} : ${c.status ?? "jamais exécutée"} (${when(c.at)})`}
            </T>
          ))
        ) : (
          <T v="small" color={colors.warn}>Tâches planifiées (pg_cron) absentes : nettoyage automatique inactif.</T>
        )}
      </Panel>
      {usage ? (
        <Panel>
          <SectionTitle>Quotas (offre gratuite)</SectionTitle>
          <T v="small">{`Messages temps réel ce mois (estimation) : ${Number(usage.month_delivered_estimate ?? 0).toLocaleString("fr-FR")} / ~2 M · profils : ${usage.profiles}`}</T>
          <Button
            label="Nettoyer les anciennes données maintenant"
            small
            variant="secondary"
            onPress={() => void run(() => api.adminCleanup(), "Nettoyage effectué.")}
          />
        </Panel>
      ) : null}
      <Panel>
        <SectionTitle>Erreurs récentes de l’application</SectionTitle>
        {(o.errors as AdminJson[]).length ? (
          (o.errors as AdminJson[]).map((e, i) => (
            <T key={i} v="small" color={colors.ivory}>{`${when(e.at)} · v${e.version ?? "?"} · ${e.context ?? e.code}`}</T>
          ))
        ) : (
          <T v="small">Aucune erreur remontée.</T>
        )}
      </Panel>
    </>
  );
}

function Players() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Awaited<ReturnType<typeof adminApi.searchPlayers>> | null>(null);
  const search = useCallback((text: string) => {
    adminApi.searchPlayers(text).then(setList).catch(() => setList([]));
  }, []);
  useEffect(() => {
    const h = setTimeout(() => search(q), 300);
    return () => clearTimeout(h);
  }, [q, search]);
  return (
    <Panel>
      <Input value={q} onChangeText={setQ} placeholder="Rechercher un pseudo" autoCapitalize="none" />
      {list === null ? <Loading /> : null}
      {list?.map((p) => (
        <Pressable key={p.id} onPress={() => router.push(`/admin/player/${p.id}`)} style={({ pressed }) => [{ paddingVertical: space.sm }, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <T>{`${p.username}${p.role !== "player" ? ` · ${ROLE_LABEL[p.role]}` : ""}`}</T>
          <T v="caption" color={p.suspended_until ? colors.danger : colors.fog}>
            {`${p.games_played} parties · ${p.wins} victoires · ${p.is_guest ? "invité" : "compte e-mail"}${p.suspended_until ? ` · suspendu jusqu'au ${when(p.suspended_until)}` : ""}`}
          </T>
        </Pressable>
      ))}
      {list && !list.length ? <T v="small">Aucun joueur.</T> : null}
    </Panel>
  );
}

function Games({ role }: { role: Role }) {
  const router = useRouter();
  const run = useRun();
  const { ask, modal } = useReason();
  const [data, setData] = useState<{ games: AdminJson[]; rooms: AdminJson[] } | null>(null);
  const load = useCallback(() => {
    adminApi.games().then(setData).catch(() => setData({ games: [], rooms: [] }));
  }, []);
  useFocusEffect(load);
  if (!data) return <Loading />;
  return (
    <>
      {modal}
      <Panel>
        <SectionTitle right={<Button label="Actualiser" small variant="ghost" icon="refresh-cw" onPress={load} />}>Parties en cours</SectionTitle>
        {data.games.map((g) => (
          <Pressable key={g.id} onPress={() => router.push(`/admin/game/${g.id}`)} style={({ pressed }) => [{ paddingVertical: space.sm }, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <T>{`${g.room_name} (${g.code}) · ${MODE_LABEL[g.mode as keyof typeof MODE_LABEL] ?? g.mode}`}</T>
            <T v="caption">{`${PHASE_LABEL[g.phase as keyof typeof PHASE_LABEL] ?? g.phase} · ${g.active}/${g.players} actifs · hôte ${g.host} · dernière activité ${when(g.updated_at)}`}</T>
          </Pressable>
        ))}
        {!data.games.length ? <T v="small">Aucune partie en cours.</T> : null}
      </Panel>
      <Panel>
        <SectionTitle>Salons</SectionTitle>
        {data.rooms.map((r) => (
          <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 4 }}>
            <View style={{ flex: 1 }}>
              <T>{`${r.name} (${r.code})`}</T>
              <T v="caption">{`${r.status} · ${r.members} membre(s) · hôte ${r.host} · ${when(r.last_activity_at)}`}</T>
            </View>
            {ROLE_RANK[role] >= ROLE_RANK.admin ? (
              <Button
                label="Fermer"
                small
                variant="ghost"
                onPress={async () => {
                  const reason = await ask({ title: `Fermer « ${r.name} » ?`, message: "Une partie en cours est terminée sans résultat compté. Les joueurs sont prévenus.", confirm: "Fermer", destructive: true });
                  if (reason && (await run(() => adminApi.closeRoom(r.id, reason), "Salon fermé."))) load();
                }}
              />
            ) : null}
          </View>
        ))}
      </Panel>
    </>
  );
}

function Reports() {
  const run = useRun();
  const { ask, modal } = useReason();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [list, setList] = useState<AdminJson[] | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    adminApi.reports(null).then((l) => setList(l)).catch(() => setList([]));
  }, []);
  useFocusEffect(load);
  const shown = (list ?? []).filter((r) => filter === "all" || r.status !== "closed");
  return (
    <>
      {modal}
      <Segmented value={filter} onChange={setFilter} options={[{ value: "open", label: "À traiter" }, { value: "all", label: "Tous" }]} />
      {list === null ? <Loading /> : null}
      {shown.map((r) => (
        <Panel key={r.id}>
          <T v="heading">{`${r.category} · ${r.status === "closed" ? "clos" : r.status === "in_review" ? "en cours" : "nouveau"}`}</T>
          <T v="caption">{`Par ${r.reporter?.username ?? "?"}${r.target ? ` · concerne ${r.target.username}` : ""} · ${when(r.created_at)}`}</T>
          <T color={colors.ivory}>{r.message}</T>
          {(r.notes as AdminJson[]).map((n, i) => (
            <T key={i} v="small">{`${n.author ?? "?"} (${when(n.at)}) : ${n.note}`}</T>
          ))}
          {r.resolution ? <T v="small" color={colors.fugitive}>{`Décision : ${r.resolution}`}</T> : null}
          {r.status !== "closed" ? (
            <>
              <Input value={note[r.id] ?? ""} onChangeText={(t) => setNote({ ...note, [r.id]: t })} placeholder="Ajouter une note interne" />
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button
                  label="Ajouter la note"
                  small
                  variant="secondary"
                  style={{ flex: 1 }}
                  disabled={(note[r.id] ?? "").trim().length < 3}
                  onPress={async () => {
                    if (await run(() => adminApi.reportNote(r.id, note[r.id]), "Note ajoutée.")) {
                      setNote({ ...note, [r.id]: "" });
                      load();
                    }
                  }}
                />
                <Button
                  label="Clore"
                  small
                  style={{ flex: 1 }}
                  onPress={async () => {
                    const res = await ask({ title: "Clore le signalement", message: "Indiquez la décision prise (ex. avertissement, aucune suite).", confirm: "Clore" });
                    if (res && (await run(() => adminApi.reportStatus(r.id, "closed", res), "Signalement clos."))) load();
                  }}
                />
              </View>
            </>
          ) : null}
        </Panel>
      ))}
      {list && !shown.length ? <T v="small">Aucun signalement.</T> : null}
    </>
  );
}

function SettingsTab() {
  const run = useRun();
  const { ask, modal } = useReason();
  const [s, setS] = useState<AdminJson | null>(null);
  const [rel, setRel] = useState({ version: APP_VERSION, severity: "optional" as "optional" | "recommended" | "critical", url: "", notes: "", minBuild: "" });
  const load = useCallback(() => {
    loadAppSettings(true).then((v) => setS(JSON.parse(JSON.stringify(v))));
  }, []);
  useFocusEffect(load);
  if (!s) return <Loading />;
  const save = async (key: string, value: unknown) => {
    const reason = await ask({ title: "Enregistrer le paramètre", message: `Paramètre « ${key} ».` });
    if (reason && (await run(() => adminApi.setSetting(key, value, reason), "Paramètre enregistré."))) load();
  };
  const features = (s.features ?? {}) as Record<string, boolean>;
  const FEATURES: [string, string][] = [
    ["royale", "Mode Royale"], ["misterx", "Mode Mister X"], ["qr_capture", "Capture par QR code"], ["objectives", "Objectifs (balises, extraction)"],
    ["spectators", "Mode spectateur"], ["replay", "Replay 24 h"],
  ];
  const d = normalizeConfig({ duration_s: s.defaults?.duration_s, prep_s: s.defaults?.prep_s });
  return (
    <>
      {modal}
      <Panel>
        <SectionTitle>Limites</SectionTitle>
        <Stepper label="Joueurs maximum par salon" value={s.limits?.max_players ?? 20} min={2} max={20} onChange={(v) => setS({ ...s, limits: { ...s.limits, max_players: v } })} />
        <Button label="Enregistrer les limites" small variant="secondary" onPress={() => void save("limits", s.limits)} />
      </Panel>
      <Panel>
        <SectionTitle>Valeurs par défaut des nouveaux salons</SectionTitle>
        <Stepper label="Durée" value={d.duration_s} min={300} max={7200} step={300} format={formatDuration} onChange={(v) => setS({ ...s, defaults: { ...s.defaults, duration_s: v } })} />
        <Stepper label="Préparation" value={d.prep_s} min={0} max={900} step={30} format={formatDuration} onChange={(v) => setS({ ...s, defaults: { ...s.defaults, prep_s: v } })} />
        <Stepper label="Joueurs" value={s.defaults?.max_players ?? 20} min={2} max={20} onChange={(v) => setS({ ...s, defaults: { ...s.defaults, max_players: v } })} />
        <Button label="Enregistrer les valeurs par défaut" small variant="secondary" onPress={() => void save("defaults", s.defaults)} />
      </Panel>
      <Panel>
        <SectionTitle>Fonctionnalités</SectionTitle>
        {FEATURES.map(([k, label]) => (
          <Toggle key={k} label={label} value={features[k] !== false} onChange={(v) => setS({ ...s, features: { ...features, [k]: v } })} />
        ))}
        <T v="caption">Une fonctionnalité désactivée ne peut plus être choisie au lancement d’une partie (vérifié par le serveur).</T>
        <Button label="Enregistrer les fonctionnalités" small variant="secondary" onPress={() => void save("features", s.features)} />
      </Panel>
      <Panel>
        <SectionTitle>Notifications et annonce</SectionTitle>
        <Stepper label="Distance d'alerte de proximité" value={s.notifications?.proximity_m ?? 75} min={25} max={300} step={25} format={(v) => `${v} m`} onChange={(v) => setS({ ...s, notifications: { ...s.notifications, proximity_m: v } })} />
        <Button label="Enregistrer les notifications" small variant="secondary" onPress={() => void save("notifications", s.notifications)} />
        <Field label="Annonce affichée sur l'accueil (vide = aucune)">
          <Input value={s.announcement?.text ?? ""} onChangeText={(t) => setS({ ...s, announcement: { ...s.announcement, text: t } })} maxLength={280} />
        </Field>
        <Segmented value={s.announcement?.level ?? "info"} onChange={(v) => setS({ ...s, announcement: { ...s.announcement, level: v } })} options={[{ value: "info", label: "Information" }, { value: "warn", label: "Important" }]} />
        <Button label="Publier l'annonce" small variant="secondary" onPress={() => void save("announcement", s.announcement ?? { text: "", level: "info" })} />
      </Panel>
      <Panel>
        <SectionTitle>Publier une version (alerte de mise à jour)</SectionTitle>
        <T v="small">Les joueurs dont l’application a un numéro de build inférieur voient une alerte. Le lien doit pointer vers l’APK (https).</T>
        <Field label="Version"><Input value={rel.version} onChangeText={(t) => setRel({ ...rel, version: t.trim() })} autoCapitalize="none" /></Field>
        <Segmented value={rel.severity} onChange={(v) => setRel({ ...rel, severity: v })} options={[{ value: "optional", label: "Facultative" }, { value: "recommended", label: "Recommandée" }, { value: "critical", label: "Importante" }]} />
        <Field label="Lien de téléchargement (facultatif)"><Input value={rel.url} onChangeText={(t) => setRel({ ...rel, url: t.trim() })} autoCapitalize="none" keyboardType="url" /></Field>
        <Field label="Nouveautés"><Input value={rel.notes} onChangeText={(t) => setRel({ ...rel, notes: t })} multiline style={{ minHeight: 80, textAlignVertical: "top", paddingTop: 12 }} /></Field>
        <Field label="Build minimal pris en charge (facultatif)" hint="Les builds inférieurs voient « mise à jour requise »."><Input value={rel.minBuild} onChangeText={(t) => setRel({ ...rel, minBuild: t.replace(/\D/g, "") })} keyboardType="number-pad" /></Field>
        <Button
          label="Publier"
          small
          onPress={() =>
            void run(
              () => adminApi.publishRelease("android", rel.version, rel.severity, rel.url || null, rel.notes, rel.minBuild ? Number(rel.minBuild) : null),
              "Version publiée.",
            )
          }
        />
      </Panel>
    </>
  );
}

function Audit() {
  const [list, setList] = useState<AdminJson[] | null>(null);
  useFocusEffect(useCallback(() => void adminApi.audit(200).then(setList).catch(() => setList([])), []));
  if (!list) return <Loading />;
  return (
    <Panel>
      {list.map((a) => (
        <View key={a.id} style={{ paddingVertical: 4 }}>
          <T>{`${a.action} · ${a.target_type}${a.target_id ? ` ${String(a.target_id).slice(0, 8)}` : ""}`}</T>
          <T v="caption">{`${when(a.at)} · ${a.actor ?? "?"} (${a.role}) · ${a.reason ?? ""}`}</T>
        </View>
      ))}
      {!list.length ? <T v="small">Journal vide.</T> : null}
    </Panel>
  );
}

export default function Admin() {
  const { profile } = useAuth();
  const role = (profile?.role ?? "player") as Role;
  const [tab, setTab] = useState<Tab>("overview");
  const allowed = TABS.filter((t) => ROLE_RANK[role] >= ROLE_RANK[t.min]);
  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Administration" }} />
        {ROLE_RANK[role] < ROLE_RANK.moderator ? (
          <Notice tone="error">Accès réservé à l’équipe d’administration.</Notice>
        ) : (
          <>
            <T v="caption">{`Connecté en tant que ${ROLE_LABEL[role]}. Toutes les actions sont vérifiées par le serveur, exigent un motif et sont journalisées.`}</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
              {allowed.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t.id }}
                  style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: tab === t.id ? colors.volt : colors.slate }}
                >
                  <T v="small" color={tab === t.id ? "#fff" : colors.ivory}>{t.label}</T>
                </Pressable>
              ))}
            </ScrollView>
            {tab === "overview" ? <Overview role={role} /> : null}
            {tab === "players" ? <Players /> : null}
            {tab === "games" ? <Games role={role} /> : null}
            {tab === "reports" ? <Reports /> : null}
            {tab === "settings" ? <SettingsTab /> : null}
            {tab === "audit" ? <Audit /> : null}
          </>
        )}
      </Screen>
    </Guard>
  );
}
