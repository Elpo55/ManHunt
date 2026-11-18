/**
 * Client Supabase mobile.
 * Session stockée dans le trousseau sécurisé (Keychain iOS / Keystore
 * Android) via expo-secure-store, découpée en morceaux (limite ~2 Ko par
 * entrée). Seule la clé PUBLIQUE est embarquée.
 */
import "react-native-url-polyfill/auto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from "./env";

const CHUNK = 1800;
const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, "_");

/** Stockage chiffré par l'OS, tolérant aux valeurs longues. */
export const secureChunkedStorage = {
  async getItem(key: string): Promise<string | null> {
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}.n`);
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const part = await SecureStore.getItemAsync(`${k}.${i}`);
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join("");
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    await this.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${k}.n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}.n`);
    if (count) for (let i = 0; i < Number(count); i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
    await SecureStore.deleteItemAsync(`${k}.n`);
  },
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isConfigured) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage: secureChunkedStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    // Rafraîchissement du jeton seulement au premier plan (recommandation Supabase pour React Native).
    AppState.addEventListener("change", (state) => {
      if (state === "active") client?.auth.startAutoRefresh();
      else client?.auth.stopAutoRefresh();
    });
  }
  return client;
}
