/**
 * Écran de jeu : carte réelle plein écran + HUD.
 * Toujours visibles : chronomètre (horloge serveur), état du partage GPS,
 * bouton « Arrêt » (sécurité). Le GPS ne tourne que pendant la partie.
 */
import { Feather } from "@expo/vector-icons";
import {
  ABILITIES,
  MARKER_KINDS,
  MAP_COLORS,
  MODE_LABEL,
  PHASE_LABEL,
  QUICK_LABEL,
  QUICK_MESSAGES,
  TEAM_LABEL,
  TEAM_SINGULAR,
  abilitiesFor,
  describeContact,
  describeEvent,
  distanceM,
  formatAge,
  formatClock,
  formatMeters,
  isStale,
  myDisplayPosition,
  type AbilityKey,
  type FC,
  type GameEvent,
  type GameState,
} from "@traque/shared";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MyCaptureCode, ScanCapture } from "../../../components/game/CapturePanels";
import { SosActive, SosRaise } from "../../../components/game/SosPanels";
import { GameMap, type GameMapHandle } from "../../../components/map/GameMap";
import { Avatar, Button, IconButton, Loading, Notice, Segmented, T, useActionSheet, useBackHandler, useToast, type IconName } from "../../../components/ui";
import { api, ROLE_RANK } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useAppSettings } from "../../../lib/appSettings";
import { APP_NAME } from "../../../lib/env";
import { clearGameNotifications, notifyLocal } from "../../../lib/notify";
import { useGame } from "../../../lib/game/useGame";
import { useLocationPermissions } from "../../../lib/location/permissions";
import { getSettings, haptic, useSettings, type NotifyCategory } from "../../../lib/settings";
import { colors, radius, space, teamColor } from "../../../theme";

/** Catégorie de notification locale de chaque type d'événement. */
const CATEGORY: Record<string, NotifyCategory> = {
  capture: "capture", player_status: "capture", phase_changed: "phase", game_finished: "phase",
  radar: "radar", radar_ping: "radar", reveal: "radar", tracker: "radar", sonar: "radar",
  zone_next: "radar", zone_shrink: "radar", misterx_reveal: "radar", misterx_revealed: "radar",
  team_msg: "team", objective_claimed: "team", extracted: "team", extraction_open: "team", achievement: "team",
  sos: "safety", sos_resolved: "safety", gps_silent: "safety", admin_action: "safety", zone_status: "safety", alert: "proximity",
};
const clockTime = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function KeepAwake() {
  useKeepAwake();
  return null;
}

function remaining(s: GameState, now: number) {
  if (s.game.phase === "paused") return s.game.paused_remaining_ms ?? 0;
  return s.game.phase_ends_at ? s.game.phase_ends_at - now : 0;
}

function ActionButton({
  icon,
  label,
  onPress,
  cooldownMs = 0,
  disabled,
  tone = "default",
  badge,
  loading,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  cooldownMs?: number;
  disabled?: boolean;
  tone?: "default" | "hunter" | "volt";
  badge?: string;
  loading?: boolean;
}) {
  const cooling = cooldownMs > 0;
  const off = disabled || cooling || loading;
  const bg = off ? colors.slate : tone === "hunter" ? colors.hunter : tone === "volt" ? colors.volt : colors.slate;
  const fg = off ? colors.fog2 : tone === "default" ? colors.ivory : "#fff";
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={cooling ? `${label}, disponible dans ${Math.ceil(cooldownMs / 1000)} secondes` : label}
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [styles.action, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }]}
    >
      <Feather name={icon} size={20} color={fg} />
      <T v="caption" color={fg} numberOfLines={1}>
        {cooling ? `${Math.ceil(cooldownMs / 1000)} s` : label}
      </T>
      {badge ? <T v="caption" color={colors.fog} style={styles.badge}>{badge}</T> : null}
    </Pressable>
  );
}

type Tab = "players" | "team" | "radar" | "journal";

function TeamTab({ s, now, onMessage, onRemoveMarker, pending }: { s: GameState; now: number; onMessage: (code: string) => void; onRemoveMarker: (id: string) => void; pending: string | null }) {
  const active = s.me.status === "active" && s.game.phase !== "finished";
  const mates = Object.values(s.players).filter((p) => p.team === s.me.team && p.u !== s.me.u && p.status === "active");
  return (
    <View style={{ gap: space.md }}>
      {active ? (
        <View style={styles.quickGrid}>
          {QUICK_MESSAGES.map((m) => (
            <Pressable
              key={m.code}
              onPress={() => onMessage(m.code)}
              disabled={!!pending}
              style={({ pressed }) => [styles.quick, pressed && { backgroundColor: colors.slate2 }]}
              accessibilityRole="button"
              accessibilityLabel={`Envoyer à l'équipe : ${m.label}`}
            >
              <Feather name={m.icon as IconName} size={14} color={colors.fog} />
              <T v="caption" color={colors.ivory} numberOfLines={1}>{m.label}</T>
            </Pressable>
          ))}
        </View>
      ) : (
        <T v="small">Spectateur : vous ne pouvez plus communiquer avec une équipe en jeu.</T>
      )}
      {s.teamMessages.length ? (
        <View style={{ gap: 4 }}>
          {[...s.teamMessages].reverse().map((m) => (
            <T key={`${m.u}:${m.at}`} v="small" color={colors.ivory}>
              {m.u === s.me.u ? "Vous" : (s.players[m.u]?.username ?? "?")} : {QUICK_LABEL[m.code] ?? m.code}
              <T v="caption"> · {formatAge(now - m.at)}</T>
            </T>
          ))}
        </View>
      ) : null}
      {mates.length ? (
        <View style={{ gap: 6 }}>
          <T v="caption">Coéquipiers</T>
          {mates.map((p) => {
            const h = s.ext.health[p.u];
            const silent = s.ext.silent.includes(p.u);
            return (
              <View key={p.u} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Avatar avatar={p.avatar} name={p.username} size={24} />
                <T style={{ flex: 1 }} numberOfLines={1}>{p.username}</T>
                {silent ? <T v="caption" color={colors.warn}>GPS muet</T> : null}
                {h?.app === "background" ? <Feather name="moon" size={13} color={colors.fog} accessibilityLabel="application en arrière-plan" /> : null}
                <T v="caption" color={h?.battery != null && h.battery <= 15 ? colors.warn : colors.fog}>
                  {h?.battery != null ? `${h.battery} %` : "batterie ?"}
                </T>
              </View>
            );
          })}
        </View>
      ) : null}
      {s.ext.markers.length ? (
        <View style={{ gap: 6 }}>
          <T v="caption">Repères actifs (appui long sur la carte pour en poser)</T>
          {s.ext.markers.map((m) => (
            <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: MARKER_KINDS.find((k) => k.kind === m.kind)?.color }} />
              <T v="small" style={{ flex: 1 }} color={colors.ivory}>
                {MARKER_KINDS.find((k) => k.kind === m.kind)?.label} · {m.u === s.me.u ? "vous" : s.players[m.u]?.username} · {formatClock(m.expires_at - now)}
              </T>
              {active ? <Button label="Retirer" small variant="ghost" onPress={() => onRemoveMarker(m.id)} /> : null}
            </View>
          ))}
        </View>
      ) : active ? (
        <T v="caption">Appui long sur la carte pour signaler un lieu à votre équipe.</T>
      ) : null}
    </View>
  );
}

function Sheet({
  s, now, online, tab, setTab, team,
}: { s: GameState; now: number; online: Set<string>; tab: Tab; setTab: (t: Tab) => void; team: ReactNode }) {
  const stale = s.game.config.stale_after_s;
  const lastSeen = (u: string) => (s.allies[u]?.at ?? s.enemies[u]?.at ?? null);
  return (
    <View style={styles.sheet}>
      <Segmented value={tab} onChange={setTab} options={[{ value: "players", label: "Joueurs" }, { value: "team", label: "Équipe" }, { value: "radar", label: "Radar" }, { value: "journal", label: "Journal" }]} />
      <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: space.sm, paddingTop: space.md }}>
        {tab === "players"
          ? (["hunter", "fugitive"] as const).map((team) => (
              <View key={team} style={{ gap: space.sm }}>
                <T v="caption" color={teamColor(team)}>{TEAM_LABEL[team]}</T>
                {Object.values(s.players)
                  .filter((p) => p.team === team)
                  .map((p) => {
                    const at = p.u === s.me.u ? (s.device?.timestamp ?? s.me.pos_at) : lastSeen(p.u);
                    const old = p.u !== s.me.u && isStale(at, now, stale);
                    const status =
                      p.status === "captured" ? "capturé" : p.status === "abandoned" ? "a quitté" : !p.connected ? "déconnecté" : s.ext.silent.includes(p.u) ? "GPS muet" : p.out_of_zone ? "hors zone" : at ? (old ? `obsolète · ${formatAge(now - at)}` : formatAge(now - at)) : "position inconnue";
                    return (
                      <View key={p.u} style={{ flexDirection: "row", alignItems: "center", gap: space.md, opacity: p.status === "active" ? 1 : 0.5 }}>
                        <Avatar avatar={p.avatar} name={p.username} size={28} />
                        <T style={{ flex: 1 }} numberOfLines={1}>{p.u === s.me.u ? `${p.username} (vous)` : p.username}</T>
                        {online.has(p.u) ? null : <Feather name="wifi-off" size={14} color={colors.fog2} />}
                        <T v="caption" color={old || p.out_of_zone ? colors.warn : colors.fog}>{status}</T>
                      </View>
                    );
                  })}
              </View>
            ))
          : null}
        {tab === "team" ? team : null}
        {tab === "radar" ? (
          s.radar ? (
            s.radar.contacts.map((c, i) => <T key={i} v="small" color={colors.ivory}>{describeContact(c)}</T>)
          ) : (
            <T v="small">
              {s.game.config.radar.enabled
                ? s.game.next_radar_at && s.game.phase === "running"
                  ? `Prochaine impulsion dans ${formatClock(s.game.next_radar_at - now)}.`
                  : "Aucun résultat radar en cours."
                : "Radar désactivé pour cette partie."}
            </T>
          )
        ) : null}
        {tab === "journal"
          ? [...s.journal].reverse().map((ev: GameEvent) => {
              const line = describeEvent(ev, s);
              return line ? <T key={`${ev.s}:${ev.sn}`} v="small" color={line.tone === "hunter" ? colors.hunter : line.tone === "alert" ? colors.warn : colors.ivory}>{line.text}</T> : null;
            })
          : null}
      </ScrollView>
    </View>
  );
}

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const sheetMenu = useActionSheet();
  const perms = useLocationPermissions();
  const [settings] = useSettings();
  const mapRef = useRef<GameMapHandle>(null);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState<Tab>("players");
  const [qrOpen, setQrOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [spectatorFc, setSpectatorFc] = useState<FC | undefined>(undefined);
  const lastProximity = useRef(0);
  // Distance d'alerte de proximité (réglable par l'administration).
  const proximityM = useAppSettings().notifications?.proximity_m ?? 75;
  const royaleWarned = useRef<number | null>(null);

  const onEvent = useCallback(
    (ev: GameEvent, st: GameState) => {
      const line = describeEvent(ev, st);
      if (!line?.notify) return;
      toast.push(line.text, line.tone === "hunter" ? "hunter" : line.tone === "alert" ? "error" : "info");
      // Application en arrière-plan / écran éteint : notification locale.
      void notifyLocal(CATEGORY[ev.t] ?? "phase", APP_NAME, line.text, { key: `${ev.t}:${line.text}` });
      if (ev.t === "capture" || ev.t === "alert" || ev.t === "sos" || ev.t === "zone_shrink") haptic("warning");
      else if (ev.t === "radar" || ev.t === "radar_ping" || ev.t === "team_msg" || ev.t === "misterx_reveal") haptic("light");
    },
    [toast],
  );
  const onError = useCallback((e: { message: string }) => toast.push(e.message, "error"), [toast]);
  const g = useGame(id ?? null, session?.user.id ?? null, { onEvent, onError, locationGranted: perms.state.foreground === "granted" });
  const s = g.state;
  const c = g.controller;

  // Mode spectateur : positions différées (3 min par défaut), rafraîchies toutes les 15 s.
  const spectating = !!s && s.me.status !== "active" && s.game.phase !== "finished" && s.game.config.spectators?.enabled;
  const gameIdForSpectator = s?.game.id ?? null;
  useEffect(() => {
    if (!spectating || !gameIdForSpectator) return;
    let alive = true;
    const load = () =>
      api
        .spectator(gameIdForSpectator)
        .then((v) => {
          if (!alive) return;
          setSpectatorFc({
            type: "FeatureCollection",
            features: v.players
              .filter((p) => p.lat != null && p.lng != null)
              .map((p) => ({ type: "Feature", properties: { color: p.team === "hunter" ? MAP_COLORS.hunter : MAP_COLORS.fugitive }, geometry: { type: "Point", coordinates: [p.lng!, p.lat!] } })),
          });
        })
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [spectating, gameIdForSpectator]);

  // Fin de partie : les notifications de partie sont retirées.
  const finishedNow = s?.game.phase === "finished";
  useEffect(() => {
    if (finishedNow) void clearGameNotifications();
  }, [finishedNow]);

  // Royale : avertissement avant chaque réduction (une fois par étape).
  const royaleNextAt = s?.ext.zone?.next_at ?? null;
  const royaleStage = s?.ext.zone?.stage ?? 0;
  const royaleWarnS = s?.ext.zone?.warn_s ?? 60;
  useEffect(() => {
    if (!royaleNextAt || s?.game.phase !== "running") return;
    const left = royaleNextAt - g.now;
    if (left > 0 && left <= royaleWarnS * 1000 && royaleWarned.current !== royaleStage) {
      royaleWarned.current = royaleStage;
      const text = `La zone se réduit dans ${Math.ceil(left / 1000)} s : rejoignez le cercle en pointillés.`;
      toast.push(text, "error");
      haptic("warning");
      void notifyLocal("radar", APP_NAME, text, { key: `royale:${royaleStage}` });
    }
  }, [royaleNextAt, royaleStage, royaleWarnS, g.now, s?.game.phase, toast]);

  const nearestEnemy = useMemo(() => {
    if (!s) return null;
    const me = myDisplayPosition(s);
    if (!me) return null;
    let best: number | null = null;
    for (const e of Object.values(s.enemies)) {
      if (e.hidden || e.lat == null || e.lng == null || isStale(e.at, g.now, s.game.config.stale_after_s)) continue;
      const d = distanceM(me, { lat: e.lat, lng: e.lng });
      if (best === null || d < best) best = d;
    }
    return best;
  }, [s, g.now]);

  // Alerte de proximité : un Chasseur s'approche (Fugitif) / un Fugitif est détecté (Chasseur).
  const myTeam = s?.me.team;
  const myActive = s?.me.status === "active" && s?.game.phase === "running";
  useEffect(() => {
    if (!myActive || nearestEnemy === null || nearestEnemy > proximityM) return;
    if (Date.now() - lastProximity.current < 60_000) return;
    lastProximity.current = Date.now();
    const text = myTeam === "fugitive" ? `Un Chasseur est proche (~${formatMeters(nearestEnemy)}).` : `Fugitif détecté à ~${formatMeters(nearestEnemy)}.`;
    toast.push(text, myTeam === "fugitive" ? "error" : "hunter");
    haptic("warning");
    void notifyLocal("proximity", APP_NAME, text, { key: "proximity", minIntervalMs: 60_000 });
  }, [nearestEnemy, myActive, myTeam, toast, proximityM]);

  const hostMenu = useCallback(() => {
    if (!s || !c) return;
    const finished = s.game.phase === "finished";
    const active = s.me.status === "active" && !finished;
    const isHost = s.view.room.host_id === session?.user.id;
    sheetMenu.show({
      title: "Partie",
      message: `Salon ${s.view.room.name} · code ${s.view.room.code}`,
      actions: [
        ...(isHost && !finished
          ? [
              s.game.phase === "paused"
                ? { label: "Reprendre", icon: "play" as IconName, onPress: () => void c.resume() }
                : { label: "Mettre en pause", icon: "pause" as IconName, onPress: () => void c.pause() },
              {
                label: "Terminer la partie",
                icon: "square" as IconName,
                tone: "destructive" as const,
                onPress: () =>
                  Alert.alert("Terminer la partie ?", "La partie se termine immédiatement pour tous (égalité, non comptée).", [
                    { text: "Annuler", style: "cancel" },
                    { text: "Terminer", style: "destructive", onPress: () => void c.abort() },
                  ]),
              },
            ]
          : []),
        {
          label: "Signaler un problème ou un joueur",
          icon: "flag" as IconName,
          onPress: () => router.push(`/report?room=${s.view.room.id}&game=${s.game.id}`),
        },
        {
          label: active ? "Retour au salon (partage GPS en pause)" : "Retour au salon",
          icon: "users" as IconName,
          onPress: () => router.replace(`/room/${s.view.room.id}`),
        },
      ],
    });
  }, [s, c, session?.user.id, sheetMenu, router]);

  // Retour Android : jamais de sortie silencieuse de la partie (le partage GPS
  // s'arrêterait sans prévenir). On ferme le panneau, sinon on ouvre le menu.
  useBackHandler(() => {
    if (!s || s.game.phase === "finished") return false;
    if (sheet) setSheet(false);
    else hostMenu();
    return true;
  });

  const onLongPress = useCallback(
    (lat: number, lng: number) => {
      if (!c || !s || s.me.status !== "active" || s.game.phase === "finished") return;
      sheetMenu.show({
        title: "Signaler ce lieu à l'équipe",
        message: "Le repère disparaît après 3 minutes. L'équipe adverse ne le voit pas.",
        actions: MARKER_KINDS.map((k) => ({
          label: k.label,
          icon: "map-pin" as IconName,
          onPress: () =>
            void c.placeMarker(k.kind, lat, lng).then((ok) => {
              if (ok) {
                toast.push("Repère envoyé à votre équipe.", "success");
                haptic("light");
              }
            }),
        })),
      });
    },
    [c, s, sheetMenu, toast],
  );

  if (!id) return null;
  if (g.error && !s) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.abyss, padding: space.lg, gap: space.lg }}>
        <Notice tone="error">{g.error.message}</Notice>
        <Button label="Accueil" onPress={() => router.replace("/")} />
      </SafeAreaView>
    );
  }
  if (!s || !c) return <Loading label="Synchronisation avec le serveur" />;

  const finished = s.game.phase === "finished";
  const active = s.me.status === "active" && !finished;
  const isHost = s.view.room.host_id === session?.user.id;
  const cfg = s.game.config;
  const ms = remaining(s, g.now);

  // État du partage de position, affiché en permanence.
  const gps = (() => {
    if (!active) return { icon: "map-pin" as IconName, color: colors.fog2, text: "Partage arrêté" };
    if (perms.state.foreground !== "granted") return { icon: "alert-triangle" as IconName, color: colors.warn, text: "Localisation non autorisée" };
    if (!s.device) return { icon: "loader" as IconName, color: colors.warn, text: "Recherche du signal GPS…" };
    const age = g.now - s.device.timestamp;
    if (age > cfg.stale_after_s * 1000) return { icon: "alert-triangle" as IconName, color: colors.warn, text: `Signal GPS perdu (${formatAge(age)})` };
    if (g.uplink.status === "offline") return { icon: "wifi-off" as IconName, color: colors.warn, text: "Hors ligne : position non transmise" };
    if (g.uplink.status === "rejected") return { icon: "alert-triangle" as IconName, color: colors.warn, text: "Position refusée par le serveur" };
    return {
      icon: "navigation" as IconName,
      color: s.device.accuracy <= cfg.max_accuracy_m ? colors.fugitive : colors.warn,
      text: `Partagée · ±${Math.round(s.device.accuracy)} m${g.tracking?.background ? " · arrière-plan" : ""}`,
    };
  })();

  const safetyStop = () =>
    Alert.alert(
      "Arrêter le partage de position ?",
      "Vous quittez immédiatement la partie et vos positions enregistrées sont effacées. Cette action est définitive pour cette partie.",
      [
        { text: "Continuer à jouer", style: "cancel" },
        {
          text: "Arrêter maintenant",
          style: "destructive",
          onPress: async () => {
            await c.safetyStop();
            toast.push("Partage arrêté. Vous avez quitté la partie.", "info");
          },
        },
      ],
    );

  const capture = async () => {
    const r = await c.capture();
    if (r && r.length === 0) {
      toast.push("Aucun Fugitif assez proche.");
      haptic("light");
    } else if (r && r.length) haptic("success");
  };

  const abilityCooldown = (k: AbilityKey) => {
    const cd = s.cooldowns[k];
    return cd ? cd.last_used_at + cfg.abilities[k].cooldown_s * 1000 - g.now : 0;
  };
  const abilityLeft = (k: AbilityKey) => (cfg.abilities[k].max_uses ? cfg.abilities[k].max_uses - (s.cooldowns[k]?.uses ?? 0) : null);
  const radarManual = cfg.radar.enabled && cfg.radar.mode === "manual" && (cfg.radar.teams === "both" || cfg.radar.teams === s.me.team);
  const running = s.game.phase === "running";

  const actions: ReactNode[] = [];
  const qrAllowed = cfg.capture_method !== "gps";
  const gpsCaptureAllowed = cfg.capture_method !== "qr";
  if (s.me.team === "hunter" && qrAllowed)
    actions.push(
      <ActionButton key="scan" icon="camera" label="Scanner" tone="hunter" onPress={() => setScanOpen(true)} disabled={!running || !active} />,
    );
  if (s.me.team === "fugitive" && qrAllowed && active && running)
    actions.push(<ActionButton key="myqr" icon="grid" label="Mon QR" onPress={() => setQrOpen(true)} />);
  if (s.me.team === "hunter" && gpsCaptureAllowed)
    actions.push(
      <ActionButton
        key="capture"
        icon="crosshair"
        label="Capturer"
        tone="hunter"
        onPress={capture}
        disabled={!running || !active}
        loading={g.pending === "capture"}
        cooldownMs={s.me.last_capture_at ? s.me.last_capture_at + cfg.capture_cooldown_s * 1000 - g.now : 0}
      />,
    );
  if (radarManual)
    actions.push(
      <ActionButton
        key="radar"
        icon="radio"
        label="Radar"
        tone="volt"
        onPress={() => void c.radar()}
        disabled={!running || !active}
        loading={g.pending === "radar"}
        cooldownMs={s.game.radar_state.radar_last ? s.game.radar_state.radar_last + cfg.radar.cooldown_s * 1000 - g.now : 0}
      />,
    );
  for (const a of abilitiesFor(s.me.team)) {
    if (!cfg.abilities[a.key]?.enabled) continue;
    const left = abilityLeft(a.key);
    actions.push(
      <ActionButton
        key={a.key}
        icon={({ ghost: "eye-off", jammer: "activity", decoy: "copy", scan: "search", tracker: "compass", sonar: "target" } as Record<AbilityKey, IconName>)[a.key]}
        label={ABILITIES[a.key].name}
        onPress={() => void c.ability(a.key)}
        disabled={!running || !active || left === 0}
        loading={g.pending === `ability:${a.key}`}
        cooldownMs={abilityCooldown(a.key)}
        badge={left !== null ? String(left) : undefined}
      />,
    );
  }

  const ext = s.ext;
  const infoBanners: { key: string; text: string; tone?: "warn" }[] = [];
  if (spectating) infoBanners.push({ key: "spec", text: `Mode spectateur : positions décalées de ${Math.round((cfg.spectators?.delay_s ?? 180) / 60)} min, sans information exploitable en direct.` });
  if (ext.zone?.next_at && s.game.phase === "running")
    infoBanners.push({ key: "royale", text: `Réduction de zone dans ${formatClock(ext.zone.next_at - g.now)} (étape ${ext.zone.stage + 1}/${ext.zone.stages}).`, tone: ext.zone.next_at - g.now <= (ext.zone.warn_s ?? 60) * 1000 ? "warn" : undefined });
  if (s.game.mode === "misterx" && ext.misterx?.next_at && s.game.phase === "running")
    infoBanners.push({
      key: "mrx",
      text: s.me.team === "fugitive" && s.me.u === ext.misterx.u
        ? `Vous êtes Mister X : révélé aux Chasseurs dans ${formatClock(ext.misterx.next_at - g.now)}.`
        : `Prochaine révélation de Mister X dans ${formatClock(ext.misterx.next_at - g.now)}.`,
    });
  if (ext.me.extracted_at) infoBanners.push({ key: "ext", text: "Vous êtes exfiltré : restez au point d'extraction, vous ne pouvez plus être capturé." });
  else if (ext.extraction_open && s.me.team === "fugitive" && active) infoBanners.push({ key: "exto", text: "Point d'extraction ouvert : rejoignez-le pour vous mettre à l'abri." });
  if (ext.me.gps_silent_since && active) infoBanners.push({ key: "silent", text: "Votre position n'arrive plus au serveur : vérifiez le GPS, le réseau et laissez l'application ouverte.", tone: "warn" });
  if (cfg.rendezvous?.set) infoBanners.push({ key: "rdv", text: `Fin vers ${s.game.phase_ends_at ? clockTime(s.game.phase_ends_at - c.clock.offset) : "—"} · Rendez-vous : ${cfg.rendezvous.label}` });
  const isAdmin = ROLE_RANK[profile?.role ?? "player"] >= ROLE_RANK.admin;
  const canResolveSos = !!ext.sos && (ext.sos.u === session?.user.id || isHost || isAdmin);

  const banner =
    s.game.phase === "paused"
      ? "Partie en pause : restez où vous êtes."
      : s.game.phase === "preparation"
        ? s.me.team === "fugitive"
          ? "Préparation : dispersez-vous dans la zone. Les Chasseurs ne vous voient pas encore."
          : "Préparation : attendez le signal. Les Fugitifs se dispersent."
        : s.me.status === "captured"
          ? "Vous avez été capturé : votre position n'est plus partagée."
          : s.me.status === "abandoned"
            ? "Vous avez quitté la partie : votre position n'est plus partagée."
            : s.me.out_of_zone_since
              ? `Hors zone : revenez dans le cercle (${formatClock(s.me.out_of_zone_since + cfg.out_of_zone_grace_s * 1000 - g.now)}).`
              : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.abyss }}>
      {active && (settings.keepAwake || getSettings().keepAwake) ? <KeepAwake /> : null}
      <GameMap ref={mapRef} state={s} now={Math.floor(g.now / 1000) * 1000} spectators={spectating ? spectatorFc : undefined} onLongPress={onLongPress} />

      <SafeAreaView edges={["top"]} style={styles.top} pointerEvents="box-none">
        <View style={styles.hud}>
          <View style={{ flex: 1 }}>
            <T v="caption" color={teamColor(s.me.team)}>{TEAM_SINGULAR[s.me.team]}</T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={[styles.dot, { backgroundColor: g.connection === "live" ? colors.fugitive : colors.warn }]} />
              <T v="caption">{g.connection === "live" ? "En direct" : g.connection === "offline" ? "Hors ligne" : "Reconnexion…"}</T>
            </View>
          </View>
          <View style={{ alignItems: "center" }}>
            <T v="numLarge" color={s.game.phase === "running" && ms < 120_000 ? colors.hunter : colors.ivory} style={{ fontSize: 28 }}>
              {finished ? "00:00" : formatClock(ms)}
            </T>
            <T v="caption">{PHASE_LABEL[s.game.phase]}</T>
          </View>
          <View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end" }}>
            <IconButton icon="more-vertical" label="Menu de la partie" onPress={hostMenu} tint={colors.ivory} />
          </View>
        </View>
        <View style={styles.gpsRow}>
          <View style={styles.gps} accessibilityRole="text" accessibilityLabel={`État de la localisation : ${gps.text}`}>
            <Feather name={gps.icon} size={14} color={gps.color} />
            <T v="caption" color={colors.ivory} numberOfLines={1}>{gps.text}</T>
          </View>
          {!finished ? (
            <Pressable onPress={() => setSosOpen(true)} style={styles.sos} accessibilityRole="button" accessibilityLabel="SOS : suspendre la partie et alerter tous les joueurs">
              <Feather name="alert-octagon" size={14} color="#fff" />
              <T v="caption" color="#fff">SOS</T>
            </Pressable>
          ) : null}
          {active ? (
            <Pressable onPress={safetyStop} style={styles.stop} accessibilityRole="button" accessibilityLabel="Arrêt de sécurité : arrêter le partage de position et quitter la partie">
              <Feather name="power" size={14} color="#fff" />
              <T v="caption" color="#fff">Arrêt</T>
            </Pressable>
          ) : null}
        </View>
        {banner ? <View style={styles.banner}><T v="small" color={colors.ivory}>{banner}</T></View> : null}
        {infoBanners.map((b) => (
          <View key={b.key} style={styles.banner}>
            <T v="caption" color={b.tone === "warn" ? colors.warn : colors.ivory}>{b.text}</T>
          </View>
        ))}
        {perms.state.foreground === "granted" && perms.state.background !== "granted" && active ? (
          <View style={styles.banner}>
            <T v="caption" color={colors.warn}>Arrière-plan non autorisé : gardez l’application ouverte, sinon votre position deviendra obsolète.</T>
          </View>
        ) : null}
      </SafeAreaView>

      {sheet ? null : (
        <View style={styles.mapButtons}>
          <IconButton icon="navigation" label="Centrer sur moi" onPress={() => mapRef.current?.recenter()} tint={colors.ivory} />
          <IconButton icon="maximize" label="Voir toute la zone" onPress={() => mapRef.current?.showZone()} tint={colors.ivory} />
        </View>
      )}

      <SafeAreaView edges={["bottom"]} style={styles.bottom}>
        {sheet ? (
          <Sheet
            s={s}
            now={g.now}
            online={g.online}
            tab={tab}
            setTab={setTab}
            team={<TeamTab s={s} now={g.now} pending={g.pending} onMessage={(code) => void c.teamMessage(code)} onRemoveMarker={(mid) => void c.removeMarker(mid)} />}
          />
        ) : null}
        {finished ? (
          <View style={styles.dock}>
            <T v="heading" color={s.game.winner === "hunter" ? colors.hunter : s.game.winner === "fugitive" ? colors.fugitive : colors.ivory}>
              {s.game.winner === "hunter" || s.game.winner === "fugitive" ? `Victoire des ${TEAM_LABEL[s.game.winner]}` : "Égalité"}
            </T>
            <T v="small">Le partage de position est arrêté.</T>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button label="Résultats" style={{ flex: 1 }} onPress={() => router.replace(`/game/${s.game.id}/results`)} />
              <Button label="Salon" variant="secondary" style={{ flex: 1 }} onPress={() => router.replace(`/room/${s.view.room.id}`)} />
            </View>
          </View>
        ) : (
          <View style={styles.dock}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <T v="caption">
                {s.me.team === "hunter" && nearestEnemy !== null
                  ? `Fugitif visible le plus proche : ~${formatMeters(nearestEnemy)} (capture ≤ ${cfg.capture_radius_m} m)`
                  : s.me.team === "fugitive" && nearestEnemy !== null
                    ? `Chasseur visible le plus proche : ~${formatMeters(nearestEnemy)}`
                    : s.radar
                      ? `Radar : ${s.radar.contacts.length} contact(s)`
                      : `${MODE_LABEL[s.game.mode]}${s.game.phase_ends_at ? ` · fin vers ${clockTime(s.game.phase_ends_at - c.clock.offset)}` : ""}`}
              </T>
              <Pressable onPress={() => setSheet((v) => !v)} accessibilityRole="button" accessibilityLabel={sheet ? "Masquer les informations" : "Afficher joueurs, radar et journal"} hitSlop={10}>
                <Feather name={sheet ? "chevron-down" : "chevron-up"} size={22} color={colors.fog} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>{actions}</View>
          </View>
        )}
      </SafeAreaView>

      {ext.sos ? (
        <SosActive
          sos={ext.sos}
          canResolve={canResolveSos}
          isHost={isHost}
          controller={c}
          onCenter={ext.sos.lat != null && ext.sos.lng != null ? () => mapRef.current?.focus(ext.sos!.lat!, ext.sos!.lng!) : undefined}
        />
      ) : null}
      <SosRaise controller={c} visible={sosOpen} onClose={() => setSosOpen(false)} />
      {qrOpen ? <MyCaptureCode controller={c} onClose={() => setQrOpen(false)} now={g.now} /> : null}
      {scanOpen ? <ScanCapture controller={c} onClose={() => setScanOpen(false)} onCaptured={() => toast.push("Capture confirmée.", "success")} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: space.md, gap: space.sm },
  hud: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(5,6,8,0.86)", borderRadius: radius.panel, paddingHorizontal: space.md, paddingVertical: space.sm },
  dot: { width: 7, height: 7, borderRadius: 4 },
  gpsRow: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  gps: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(16,19,25,0.92)", borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 34 },
  stop: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 34 },
  sos: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#b3261e", borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 34, borderWidth: 1, borderColor: "#ffb4ab" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quick: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.slate, borderRadius: radius.pill, paddingHorizontal: 10, minHeight: 36 },
  banner: { backgroundColor: "rgba(16,19,25,0.94)", borderRadius: radius.control, padding: space.md },
  mapButtons: { position: "absolute", right: space.md, top: "45%", backgroundColor: "rgba(16,19,25,0.9)", borderRadius: radius.control },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  dock: { backgroundColor: colors.graphite, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.md, gap: space.md },
  sheet: { backgroundColor: colors.graphite, marginHorizontal: space.md, marginBottom: space.sm, borderRadius: radius.panel, padding: space.md },
  action: { flex: 1, minHeight: 58, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 4 },
  badge: { position: "absolute", top: 4, right: 8 },
});
