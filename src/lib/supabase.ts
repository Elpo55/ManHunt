import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Projet Traque";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isConfigured = Boolean(url && anonKey && /^https?:\/\//.test(url));

let client: SupabaseClient | null = null;

/** Client Supabase unique (navigateur). Null si l'environnement n'est pas configuré. */
export function getSupabase(): SupabaseClient | null {
  if (!isConfigured) return null;
  if (typeof window === "undefined") return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}
