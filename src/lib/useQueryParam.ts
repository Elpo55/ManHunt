"use client";
import { useSearchParams } from "next/navigation";

/** Lit un paramètre d'URL (?room=...). Les pages l'utilisant sont sous <Suspense>. */
export function useQueryParam(name: string): string | null {
  const sp = useSearchParams();
  const v = sp?.get(name);
  return v && v.trim() ? v.trim() : null;
}

export function isUuid(v: string | null): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
