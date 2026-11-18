/**
 * État d'un salon : chargement par RPC, re-lecture débouncée à chaque
 * événement Realtime, présence en ligne, heartbeat toutes les 30 s.
 */
import { toAppError, type AppError } from "@traque/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, type RoomState } from "../api";
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
  const [online, setOnline] = useState<Set<string>>(() => new Set());
  const [lastEvent, setLastEvent] = useState<RoomHook["lastEvent"]>(null);
  const [presenceMeta] = useState(() => ({ joined: new Date().toISOString() }));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      setState(await api.roomState(roomId));
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
    scheduleRefresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scheduleRefresh]);

  const channel = useChannel({
    topic: roomId && userId ? `room:${roomId}` : null,
    events: ["room"],
    onMessage: (_ev, payload) => {
      setLastEvent(payload as RoomHook["lastEvent"]);
      scheduleRefresh();
    },
    onSubscribed: scheduleRefresh,
    presence: userId ? { key: userId, meta: presenceMeta, onSync: setOnline } : undefined,
  });

  useEffect(() => {
    if (!roomId || !userId) return;
    const beat = () => void api.roomHeartbeat(roomId).catch(() => undefined);
    beat();
    const id = setInterval(beat, 30_000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        beat();
        scheduleRefresh();
      }
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [roomId, userId, scheduleRefresh]);

  return { state, error, online, channel, refresh, lastEvent };
}
