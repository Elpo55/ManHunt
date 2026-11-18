/**
 * Relie le contrôleur de partie partagé à React Native :
 *  - trois canaux privés (public, équipe, personnel) ;
 *  - cycle de vie du GPS : démarre quand la partie est active et que le
 *    joueur est actif ; s'arrête à la fin, à l'élimination, à l'arrêt de
 *    sécurité, et en quittant l'écran ;
 *  - tick aux échéances serveur, heartbeat, resynchronisation au retour au premier plan.
 */
import { GameController, type AppError, type GameEvent, type GameState } from "@traque/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { gameApi } from "../api";
import { startTracking, stopTracking, type TrackingResult } from "../location/tracking";
import { useChannel, type ChannelStatus } from "../realtime/useChannel";

const EMPTY = {
  state: null,
  error: null,
  pending: null,
  uplink: { status: "idle" as const, lastSentAt: null, lastError: null, outOfZone: false },
};
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

export interface GameHook {
  state: GameState | null;
  error: AppError | null;
  pending: string | null;
  uplink: (typeof EMPTY)["uplink"] | ReturnType<GameController["getSnapshot"]>["uplink"];
  now: number;
  connection: ChannelStatus;
  online: Set<string>;
  tracking: TrackingResult | null;
  controller: GameController | null;
}

export function useGame(
  gameId: string | null,
  userId: string | null,
  opts: { onEvent?: (ev: GameEvent, s: GameState) => void; onError?: (e: AppError) => void; locationGranted: boolean },
): GameHook {
  const [controller, setController] = useState<GameController | null>(null);
  const [now, setNow] = useState(0);
  const [online, setOnline] = useState<Set<string>>(() => new Set());
  const [tracking, setTracking] = useState<TrackingResult | null>(null);
  const [presenceMeta] = useState(() => ({ joined: new Date().toISOString() }));

  useEffect(() => {
    if (!gameId || !userId) return;
    const c = new GameController(gameId, gameApi);
    setController(c);
    void c.load();
    void c.syncClock();
    return () => {
      c.dispose();
      setController(null);
    };
  }, [gameId, userId]);

  useEffect(() => {
    controller?.setCallbacks(opts.onEvent ?? null, opts.onError ?? null);
  }, [controller, opts.onEvent, opts.onError]);

  const snap = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const s = snap.state;
  const teamTopic = s ? (s.view.team_topic ?? `game:${s.game.id}:${s.me.team}`) : null;
  const handlers = controller
    ? { onMessage: (_e: string, p: unknown) => controller.handleEvent(p as GameEvent), onSubscribed: () => controller.scheduleResync(400) }
    : { onMessage: () => {}, onSubscribed: () => {} };

  const sAll = useChannel({
    topic: controller && userId ? `game:${controller.gameId}:all` : null,
    events: ["ev"],
    ...handlers,
    presence: userId ? { key: userId, meta: presenceMeta, onSync: setOnline } : undefined,
  });
  const sTeam = useChannel({ topic: controller && teamTopic ? teamTopic : null, events: ["ev"], ...handlers });
  const sMe = useChannel({ topic: controller && userId ? `game:${controller.gameId}:p:${userId}` : null, events: ["ev"], ...handlers });
  const statuses = [sAll, sTeam, sMe];
  const connection: ChannelStatus = statuses.includes("offline")
    ? "offline"
    : statuses.includes("retrying")
      ? "retrying"
      : statuses.every((x) => x === "live")
        ? "live"
        : "connecting";

  // Horloge d'affichage (2 Hz) + purge.
  useEffect(() => {
    if (!controller) return;
    const update = () => {
      const n = controller.clock.now();
      setNow(n);
      controller.prune(n);
    };
    const first = setTimeout(update, 0);
    const id = setInterval(update, 500);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [controller]);

  // Heartbeat + resynchronisation au retour au premier plan.
  useEffect(() => {
    if (!controller) return;
    const id = setInterval(() => void controller.heartbeat(), 15_000);
    const first = setTimeout(() => void controller.heartbeat(), 1500);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        void controller.heartbeat();
        controller.scheduleResync(0);
      }
    });
    return () => {
      clearInterval(id);
      clearTimeout(first);
      sub.remove();
    };
  }, [controller]);

  // Échéances serveur -> tick (gigue pour étaler les appels).
  const deadline = controller && s ? controller.nextDeadline() : null;
  useEffect(() => {
    if (!controller || !deadline) return;
    const delay = Math.max(0, deadline - controller.clock.now()) + 250 + Math.random() * 1250;
    const id = setTimeout(() => void controller.tick(), delay);
    return () => clearTimeout(id);
  }, [controller, deadline]);

  // Cycle de vie du GPS.
  const shouldTrack = !!controller && !!s && s.game.phase !== "finished" && s.me.status === "active" && opts.locationGranted;
  const interval = s?.game.config.position_interval_s ?? 5;
  useEffect(() => {
    if (!controller || !shouldTrack) {
      void stopTracking();
      setTracking(null);
      return;
    }
    let cancelled = false;
    void startTracking(controller.gameId, interval, controller.clock.offset, controller.submitFix).then((r) => {
      if (!cancelled) setTracking(r);
    });
    return () => {
      cancelled = true;
      void stopTracking();
    };
  }, [controller, shouldTrack, interval]);

  return { state: s, error: snap.error, pending: snap.pending, uplink: snap.uplink, now, connection, online, tracking, controller };
}
