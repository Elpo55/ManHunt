/**
 * Identité visuelle : sombre, minimaliste, premium.
 * Abysse / Graphite / Ardoise pour les surfaces, Ivoire pour le texte,
 * Volt comme unique accent. Les couleurs d'équipe sont réservées à l'information.
 */
export const colors = {
  abyss: "#050608",
  graphite: "#101319",
  slate: "#181c24",
  slate2: "#20252f",
  line: "#262b35",
  ivory: "#ece8df",
  fog: "#8b919c",
  fog2: "#5d636e",
  volt: "#2f6bff",
  voltSoft: "rgba(47,107,255,0.15)",
  ally: "#5b8cff",
  hunter: "#ff5a4e",
  fugitive: "#4fd1a5",
  warn: "#e8b14a",
  danger: "#ff5a4e",
} as const;

export const fonts = {
  regular: "HankenGrotesk_400Regular",
  medium: "HankenGrotesk_500Medium",
  semibold: "HankenGrotesk_600SemiBold",
  instrument: "ChakraPetch_600SemiBold",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { control: 12, panel: 18, pill: 999 } as const;

export const teamColor = (team: "hunter" | "fugitive" | null | undefined) =>
  team === "hunter" ? colors.hunter : team === "fugitive" ? colors.fugitive : colors.fog;
