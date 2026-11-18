"use client";
import { useEffect } from "react";

/** Enregistre le service worker (installation PWA, coque hors ligne). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* PWA optionnelle : l'application fonctionne sans */
    });
  }, []);
  return null;
}
