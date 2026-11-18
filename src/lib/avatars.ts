/**
 * Avatars originaux générés (aucune image externe, aucun stockage) :
 * un glyphe géométrique + une teinte. Clé : "<glyphe>:<teinte>".
 */
export const AVATAR_GLYPHS = ["orbit", "prism", "delta", "grid", "pulse", "ring", "shard", "cross"] as const;
export const AVATAR_TINTS = {
  azure: "#3D7BFF",
  ice: "#7FB4FF",
  steel: "#8A94A6",
  ivory: "#E8E4DA",
  ember: "#FF7A45",
  mint: "#3DDC97",
  violet: "#9B87F5",
  gold: "#E5B45A",
} as const;

export type AvatarGlyph = (typeof AVATAR_GLYPHS)[number];
export type AvatarTint = keyof typeof AVATAR_TINTS;

export function parseAvatar(key: string | null | undefined): { glyph: AvatarGlyph; tint: AvatarTint; color: string } {
  const [g, t] = (key ?? "").split(":");
  const glyph = (AVATAR_GLYPHS as readonly string[]).includes(g) ? (g as AvatarGlyph) : "orbit";
  const tint = t && t in AVATAR_TINTS ? (t as AvatarTint) : "azure";
  return { glyph, tint, color: AVATAR_TINTS[tint] };
}

export function randomAvatar(): string {
  const g = AVATAR_GLYPHS[Math.floor(Math.random() * AVATAR_GLYPHS.length)];
  const tints = Object.keys(AVATAR_TINTS);
  return `${g}:${tints[Math.floor(Math.random() * tints.length)]}`;
}

/** Tracés SVG (viewBox 0 0 24 24) de chaque glyphe. */
export const GLYPH_PATHS: Record<AvatarGlyph, string> = {
  orbit: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  prism: "M12 3L21 19H3Z M12 9L16.5 17H7.5Z",
  delta: "M4 6h16L12 20Z",
  grid: "M5 5h6v6H5Z M13 5h6v6h-6Z M5 13h6v6H5Z M13 13h6v6h-6Z",
  pulse: "M3 12h4l2-5l4 10l2-5h6",
  ring: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10",
  shard: "M12 2L19 10L12 22L5 10Z",
  cross: "M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7Z",
};
