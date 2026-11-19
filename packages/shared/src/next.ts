/**
 * Destination à reprendre après la connexion / le profil (ex. lien
 * d'invitation ouvert sans être connecté). Seuls les chemins internes de
 * l'application sont acceptés.
 */
export function safeNext(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.includes("://")) return null;
  if (/^\/(login|onboarding)(\?|$)/.test(v)) return null;
  return v.slice(0, 200);
}

export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
