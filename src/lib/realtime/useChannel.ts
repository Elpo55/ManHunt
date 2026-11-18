"use client";
/**
 * Abonnement à un canal Realtime PRIVÉ avec reconnexion automatique.
 * - setAuth() avant l'abonnement (autorisation RLS par topic),
 * - en cas d'erreur/timeout/fermeture : nouvel essai avec backoff exponentiel,
 * - onSubscribed est rappelé à chaque (ré)abonnement -> resynchronisation.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "../supabase";
import { metrics } from "../metrics";

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

  useEffect(() => {
    const sb = getSupabase();
    const topic = opts.topic;
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
        /* le jeton sera relu par le client */
      }
      if (disposed) return;
      const ch = sb.channel(topic, {
        config: {
          private: true,
          broadcast: { self: true },
          presence: presenceKey ? { key: presenceKey, enabled: true } : undefined,
        },
      });
      for (const ev of ref.current.events) {
        ch.on("broadcast", { event: ev }, (msg) => {
          metrics.received();
          ref.current.onMessage(ev, msg.payload);
        });
      }
      if (presenceKey) {
        ch.on("presence", { event: "sync" }, () => {
          ref.current.presence?.onSync(new Set(Object.keys(ch.presenceState())));
        });
      }
      ch.subscribe(async (st) => {
        if (disposed) return;
        if (st === "SUBSCRIBED") {
          attempt = 0;
          setStatus("live");
          if (presenceKey && ref.current.presence) {
            await ch.track(ref.current.presence.meta).catch(() => undefined);
          }
          ref.current.onSubscribed?.();
        } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
          if (st !== "CLOSED") metrics.reconnect();
          scheduleRetry();
        }
      });
      channel = ch;
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      setStatus(navigator.onLine ? "retrying" : "offline");
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

    const onOnline = () => {
      if (channel && channel.state !== "joined") {
        attempt = 0;
        scheduleRetry();
      }
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    void connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (channel) void sb.removeChannel(channel);
    };
  }, [opts.topic, presenceKey]);

  return status;
}
