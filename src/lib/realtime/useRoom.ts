"use client";
/**
 * État d'un salon : chargement via RPC, mises à jour par événements Realtime
 * (re-lecture débouncée de l'état complet : le lobby est peu fréquent),
 * présence en ligne, heartbeat toutes les 30 s.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type RoomState } from "../api";
import { toAppError, type AppError } from "../errors";
import { useChannel, type ChannelStatus } from "./useChannel";

export interface RoomHook {
  state: RoomState | null;
  error: AppError | null;
  online: Set<string>;
  channel: ChannelStatus;
  refresh: () => Promise<void>;
  lastEvent: { t: string; d: Record<string, unknown> } | null;
}

export function useRoom(roomId: string | null, userId: string | null): RoomHook {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [lastEvent, setLastEvent] = useState<RoomHook["lastEvent"]>(null);
  const [presenceMeta] = useState(() => ({ joined: new Date().toISOString() }));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const s = await api.roomState(roomId);
      setState(s);
      setError(null);
    } catch (e) {
      setError(toAppError(e));
    }
  }, [roomId]);

  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 150);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const channel = useChannel({
    topic: roomId && userId ? `room:${roomId}` : null,
    events: ["room"],
    onMessage: (_ev, payload) => {
      const p = payload as { t: string; d: Record<string, unknown> };
      setLastEvent(p);
      scheduleRefresh();
    },
    onSubscribed: scheduleRefresh,
    presence: userId ? { key: userId, meta: presenceMeta, onSync: setOnline } : undefined,
  });

  // Heartbeat : signe de vie serveur (transfert d'hôte inactif, statut).
  useEffect(() => {
    if (!roomId || !userId) return;
    const beat = () => void api.roomHeartbeat(roomId).catch(() => undefined);
    beat();
    const id = setInterval(beat, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        beat();
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [roomId, userId, refresh]);

  return { state, error, online, channel, refresh, lastEvent };
}
