/**
 * Abonnement à un canal Realtime PRIVÉ avec reconnexion automatique.
 *  - setAuth() avant l'abonnement (autorisation RLS par topic) ;
 *  - erreur, expiration ou fermeture : nouvel essai avec backoff exponentiel ;
 *  - retour au premier plan : reconnexion si nécessaire ;
 *  - onSubscribed rappelé à chaque (ré)abonnement → resynchronisation.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getSupabase } from "../supabase";

export type ChannelStatus = "connecting" | "live" | "retrying" | "offline";

export interface ChannelOptions {
  topic: string | null;
  events: string[];
  onMessage: (event: string, payload: unknown) => void;
  onSubscribed?: () => void;
  presence?: { key: string; meta: Record<string, unknown>; onSync: (keys: Set<string>) => void };
}

export function useChannel(opts: ChannelOptions): ChannelStatus {
  const [status, setStatus] = useState<ChannelStatus>("connecting");
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });
  const presenceKey = opts.presence?.key ?? null;
  const topic = opts.topic;

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !topic) return;
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (disposed) return;
      setStatus(attempt === 0 ? "connecting" : "retrying");
      try {
        await sb.realtime.setAuth();
      } catch {
        /* jeton relu par le client */
      }
      if (disposed) return;
      const ch = sb.channel(topic, {
        config: { private: true, broadcast: { self: true }, presence: presenceKey ? { key: presenceKey, enabled: true } : undefined },
      });
      for (const ev of ref.current.events) {
        ch.on("broadcast", { event: ev }, (msg) => ref.current.onMessage(ev, msg.payload));
      }
      if (presenceKey) {
        ch.on("presence", { event: "sync" }, () => ref.current.presence?.onSync(new Set(Object.keys(ch.presenceState()))));
      }
      ch.subscribe(async (st) => {
        if (disposed) return;
        if (st === "SUBSCRIBED") {
          attempt = 0;
          setStatus("live");
          if (presenceKey && ref.current.presence) await ch.track(ref.current.presence.meta).catch(() => undefined);
          ref.current.onSubscribed?.();
        } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
          scheduleRetry();
        }
      });
      channel = ch;
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      setStatus(attempt >= 3 ? "offline" : "retrying");
      const delay = Math.min(15_000, 800 * 2 ** attempt) + Math.random() * 400;
      attempt++;
      retryTimer = setTimeout(async () => {
        retryTimer = null;
        if (channel) {
          const old = channel;
          channel = null;
          await sb.removeChannel(old).catch(() => undefined);
        }
        void connect();
      }, delay);
    };

    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && channel && channel.state !== "joined") {
        attempt = 0;
        scheduleRetry();
      }
    });

    void connect();
    return () => {
      disposed = true;
      sub.remove();
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) void sb.removeChannel(channel);
    };
  }, [topic, presenceKey]);

  return status;
}
