/**
 * Écran de jeu : carte réelle plein écran + HUD.
 * Toujours visibles : chronomètre (horloge serveur), état du partage GPS,
 * bouton « Arrêt » (sécurité). Le GPS ne tourne que pendant la partie.
 */
import { Feather } from "@expo/vector-icons";
import {
  ABILITIES,
  PHASE_LABEL,
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
  type GameEvent,
  type GameState,
} from "@traque/shared";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GameMap, type GameMapHandle } from "../../../components/map/GameMap";
import { Avatar, Button, IconButton, Loading, Notice, Segmented, T, useActionSheet, useBackHandler, useToast, type IconName } from "../../../components/ui";
import { useAuth } from "../../../lib/auth";
import { useGame } from "../../../lib/game/useGame";
import { useLocationPermissions } from "../../../lib/location/permissions";
import { getSettings, haptic, useSettings } from "../../../lib/settings";
import { colors, radius, space, teamColor } from "../../../theme";

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

function Sheet({ s, now, online, tab, setTab }: { s: GameState; now: number; online: Set<string>; tab: "players" | "radar" | "journal"; setTab: (t: "players" | "radar" | "journal") => void }) {
  const stale = s.game.config.stale_after_s;
  const lastSeen = (u: string) => (s.allies[u]?.at ?? s.enemies[u]?.at ?? null);
  return (
    <View style={styles.sheet}>
      <Segmented value={tab} onChange={setTab} options={[{ value: "players", label: "Joueurs" }, { value: "radar", label: "Radar" }, { value: "journal", label: "Journal" }]} />
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
                      p.status === "captured" ? "capturé" : p.status === "abandoned" ? "a quitté" : !p.connected ? "déconnecté" : p.out_of_zone ? "hors zone" : at ? (old ? `obsolète · ${formatAge(now - at)}` : formatAge(now - at)) : "position inconnue";
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
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const sheetMenu = useActionSheet();
  const perms = useLocationPermissions();
  const [settings] = useSettings();
  const mapRef = useRef<GameMapHandle>(null);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState<"players" | "radar" | "journal">("players");

  const onEvent = useCallback(
    (ev: GameEvent, st: GameState) => {
      const line = describeEvent(ev, st);
      if (!line?.notify) return;
      toast.push(line.text, line.tone === "hunter" ? "hunter" : line.tone === "alert" ? "error" : "info");
      if (ev.t === "capture" || ev.t === "alert") haptic("warning");
      else if (ev.t === "radar" || ev.t === "radar_ping") haptic("light");
    },
    [toast],
  );
  const onError = useCallback((e: { message: string }) => toast.push(e.message, "error"), [toast]);
  const g = useGame(id ?? null, session?.user.id ?? null, { onEvent, onError, locationGranted: perms.state.foreground === "granted" });
  const s = g.state;
  const c = g.controller;

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
  if (s.me.team === "hunter")
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
      <GameMap ref={mapRef} state={s} now={Math.floor(g.now / 1000) * 1000} />

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
          {active ? (
            <Pressable onPress={safetyStop} style={styles.stop} accessibilityRole="button" accessibilityLabel="Arrêt de sécurité : arrêter le partage de position et quitter la partie">
              <Feather name="power" size={14} color="#fff" />
              <T v="caption" color="#fff">Arrêt</T>
            </Pressable>
          ) : null}
        </View>
        {banner ? <View style={styles.banner}><T v="small" color={colors.ivory}>{banner}</T></View> : null}
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
        {sheet ? <Sheet s={s} now={g.now} online={g.online} tab={tab} setTab={setTab} /> : null}
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
                {s.me.team === "hunter" && nearestEnemy !== null ? `Fugitif visible le plus proche : ~${formatMeters(nearestEnemy)} (capture ≤ ${cfg.capture_radius_m} m)` : s.radar ? `Radar : ${s.radar.contacts.length} contact(s)` : " "}
              </T>
              <Pressable onPress={() => setSheet((v) => !v)} accessibilityRole="button" accessibilityLabel={sheet ? "Masquer les informations" : "Afficher joueurs, radar et journal"} hitSlop={10}>
                <Feather name={sheet ? "chevron-down" : "chevron-up"} size={22} color={colors.fog} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>{actions}</View>
          </View>
        )}
      </SafeAreaView>
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
  banner: { backgroundColor: "rgba(16,19,25,0.94)", borderRadius: radius.control, padding: space.md },
  mapButtons: { position: "absolute", right: space.md, top: "45%", backgroundColor: "rgba(16,19,25,0.9)", borderRadius: radius.control },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  dock: { backgroundColor: colors.graphite, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.md, gap: space.md },
  sheet: { backgroundColor: colors.graphite, marginHorizontal: space.md, marginBottom: space.sm, borderRadius: radius.panel, padding: space.md },
  action: { flex: 1, minHeight: 58, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 4 },
  badge: { position: "absolute", top: 4, right: 8 },
});
