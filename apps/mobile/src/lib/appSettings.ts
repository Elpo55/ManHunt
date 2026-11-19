/** Paramètres globaux (fixés par l'administration), lus une fois puis mis en cache. */
import { useEffect, useState } from "react";
import { api, type AppSettings } from "./api";

let cache: AppSettings | null = null;
let inflight: Promise<AppSettings> | null = null;

export function loadAppSettings(force = false): Promise<AppSettings> {
  if (cache && !force) return Promise.resolve(cache);
  if (!inflight || force) {
    inflight = api
      .appSettings()
      .then((s) => (cache = s ?? {}))
      .catch(() => cache ?? {})
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useAppSettings(): AppSettings {
  const [s, setS] = useState<AppSettings>(cache ?? {});
  useEffect(() => {
    let alive = true;
    void loadAppSettings().then((v) => alive && setS(v));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}
