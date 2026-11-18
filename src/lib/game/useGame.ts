"use client";
/**
 * Hook de partie : relie un GameController à React et aux canaux Realtime.
 *   - trois canaux privés : public (all), équipe, personnel ;
 *   - à l'échéance serveur connue, appel de game_tick() (avec gigue) ;
 *   - heartbeat toutes les 15 s et au retour au premier plan.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api";
import type { AppError } from "../errors";
import type { GameEvent } from "../engine/types";
import { useChannel, type ChannelStatus } from "../realtime/useChannel";
import { GameController } from "./controller";
import type { GameState } from "./state";

export interface GameHook {
  state: GameState | null;
  error: AppError | null;
  pending: string | null;
  now: number;
  connection: ChannelStatus;
  online: Set<string>;
  controller: GameController | null;
}

const EMPTY = { state: null, error: null, pending: null };
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

export function useGame(
  gameId: string | null,
  userId: string | null,
  onEvent?: (ev: GameEvent, state: GameState) => void,
  onError?: (e: AppError) => void,
): GameHook {
  const [controller, setController] = useState<GameController | null>(null);
  const [now, setNow] = useState(0);
  const [online, setOnline] = useState<Set<string>>(() => new Set());
  const [presenceMeta] = useState(() => ({ joined: new Date().toISOString() }));

  // Création / destruction du contrôleur.
  useEffect(() => {
    if (!gameId || !userId) return;
    const c = new GameController(gameId, api);
    setController(c);
    void c.load();
    void c.syncClock();
    return () => {
      c.dispose();
      setController(null);
    };
  }, [gameId, userId]);

  useEffect(() => {
    if (!controller) return;
    controller.setCallbacks(onEvent ?? null, onError ?? null);
  }, [controller, onEvent, onError]);

  const snap = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  const team = snap.state?.me.team ?? null;

  const handlers = controller
    ? { onMessage: (_e: string, p: unknown) => controller.handleEvent(p as GameEvent), onSubscribed: () => controller.scheduleResync(400) }
    : { onMessage: () => {}, onSubscribed: () => {} };

  const sAll = useChannel({
    topic: controller && userId ? `game:${controller.gameId}:all` : null,
    events: ["ev"],
    ...handlers,
    presence: userId ? { key: userId, meta: presenceMeta, onSync: setOnline } : undefined,
  });
  const sTeam = useChannel({ topic: controller && team ? `game:${controller.gameId}:${team}` : null, events: ["ev"], ...handlers });
  const sMe = useChannel({ topic: controller && userId ? `game:${controller.gameId}:p:${userId}` : null, events: ["ev"], ...handlers });
  const statuses = [sAll, sTeam, sMe];
  const connection: ChannelStatus = statuses.includes("offline")
    ? "offline"
    : statuses.includes("retrying")
      ? "retrying"
      : statuses.every((x) => x === "live")
        ? "live"
        : "connecting";

  // Horloge d'affichage (2 Hz) + purge des informations expirées.
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

  // Heartbeat + reprise au premier plan / retour du réseau.
  useEffect(() => {
    if (!controller) return;
    const id = setInterval(() => void controller.heartbeat(), 15_000);
    const first = setTimeout(() => void controller.heartbeat(), 1500);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void controller.heartbeat();
        controller.scheduleResync(0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      clearInterval(id);
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [controller]);

  // Échéance serveur -> tick, avec gigue pour étaler les appels des clients.
  const deadline = controller && snap.state ? controller.nextDeadline() : null;
  useEffect(() => {
    if (!controller || !deadline) return;
    const delay = Math.max(0, deadline - controller.clock.now()) + 250 + Math.random() * 1250;
    const id = setTimeout(() => void controller.tick(), delay);
    return () => clearTimeout(id);
  }, [controller, deadline]);

  return {
    state: snap.state,
    error: snap.error,
    pending: snap.pending,
    now,
    connection,
    online,
    controller,
  };
}
