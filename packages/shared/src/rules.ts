/** Règles et libellés dérivés (purs, testés). */
import type { AbilityKey, Dir8, DistanceBand, GameMode, GamePhase, RadarContact, RadarPrecision, Team } from "./types";

// ---------------------------------------------------------------------------
// Machine à états (identique aux transitions validées par le serveur)
// ---------------------------------------------------------------------------
export type LifecycleState = "lobby" | GamePhase | "results";

export const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  lobby: ["preparation", "running"],
  preparation: ["running", "paused", "finished"],
  running: ["paused", "finished"],
  paused: ["preparation", "running", "finished"],
  finished: ["results"],
  results: ["lobby"],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const PHASE_LABEL: Record<LifecycleState, string> = {
  lobby: "Salon",
  preparation: "Préparation",
  running: "Traque en cours",
  paused: "Pause",
  finished: "Terminée",
  results: "Résultats",
};

// ---------------------------------------------------------------------------
// Équipes et modes
// ---------------------------------------------------------------------------
export const TEAM_LABEL: Record<Team, string> = { hunter: "Chasseurs", fugitive: "Fugitifs" };
export const TEAM_SINGULAR: Record<Team, string> = { hunter: "Chasseur", fugitive: "Fugitif" };
export const enemyOf = (t: Team): Team => (t === "hunter" ? "fugitive" : "hunter");

export interface ModeInfo {
  id: GameMode | "mister_x" | "royale";
  label: string;
  summary: string;
  available: boolean;
}

export const MODES: ModeInfo[] = [
  { id: "classic", label: "Classique", summary: "Les Chasseurs doivent capturer tous les Fugitifs avant la fin du temps.", available: true },
  { id: "infection", label: "Infection", summary: "Chaque Fugitif capturé rejoint les Chasseurs.", available: true },
  { id: "mister_x", label: "Mister X", summary: "Un seul Fugitif, révélé périodiquement, contre tous les autres.", available: false },
  { id: "royale", label: "Royale", summary: "La zone de jeu se resserre progressivement.", available: false },
];

// ---------------------------------------------------------------------------
// Capacités (métadonnées d'interface ; les chiffres viennent du serveur)
// ---------------------------------------------------------------------------
export interface AbilityMeta {
  key: AbilityKey;
  team: Team;
  name: string;
  short: string;
  /** nécessite une position GPS fraîche */
  needsPosition: boolean;
}

export const ABILITIES: Record<AbilityKey, AbilityMeta> = {
  ghost: { key: "ghost", team: "fugitive", name: "Fantôme", short: "Position masquée", needsPosition: false },
  jammer: { key: "jammer", team: "fugitive", name: "Brouilleur", short: "Position imprécise (150 m)", needsPosition: false },
  decoy: { key: "decoy", team: "fugitive", name: "Leurre", short: "Fausse position à ~150 m", needsPosition: false },
  scan: { key: "scan", team: "hunter", name: "Scan", short: "Précise les Fugitifs à 250 m", needsPosition: true },
  tracker: { key: "tracker", team: "hunter", name: "Traqueur", short: "Cap du plus proche", needsPosition: true },
  sonar: { key: "sonar", team: "hunter", name: "Sonar", short: "Fugitifs à moins de 150 m", needsPosition: true },
};

export const abilitiesFor = (team: Team) => Object.values(ABILITIES).filter((a) => a.team === team);

// ---------------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------------
export const DIR_LABEL: Record<Dir8, string> = {
  N: "Nord", NE: "Nord-Est", E: "Est", SE: "Sud-Est", S: "Sud", SW: "Sud-Ouest", W: "Ouest", NW: "Nord-Ouest",
};
export const BAND_LABEL: Record<DistanceBand, string> = { near: "proche", mid: "à distance moyenne", far: "loin" };
export const PRECISION_LABEL: Record<RadarPrecision, string> = {
  direction: "Direction et distance",
  sector: "Secteur de la zone",
  zone: "Zone approximative",
};
const SECTOR_NAMES = ["Nord", "Nord-Est", "Est", "Sud-Est", "Sud", "Sud-Ouest", "Ouest", "Nord-Ouest"];

export function describeContact(c: RadarContact): string {
  if ("lost" in c) return "Signal perdu";
  if ("jammed" in c) return "Signal brouillé";
  if ("dir" in c) return `${DIR_LABEL[c.dir]}, ${c.dist_m < 50 ? "moins de 50 m" : `~${c.dist_m} m`}`;
  if ("sector" in c) return `Secteur ${SECTOR_NAMES[c.sector] ?? "?"} (${c.ring === 0 ? "centre" : "périphérie"})`;
  return `Zone de ${Math.round(c.r_m)} m`;
}

// ---------------------------------------------------------------------------
// Temps
// ---------------------------------------------------------------------------
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Consignes affichées et acceptées avant toute partie. */
export const SAFETY_RULES: string[] = [
  "Jouez uniquement dans des espaces publics où la présence est autorisée.",
  "N'entrez jamais dans une propriété privée, un chantier ou une zone fermée.",
  "Ne courez pas sur la chaussée ; respectez le code de la route et les feux.",
  "Restez dans la zone de jeu affichée sur la carte.",
  "Aucun contact physique n'est nécessaire : la capture se fait par proximité GPS.",
  "Vous pouvez arrêter le partage de votre position à tout moment (bouton Arrêt).",
  "Votre position n'est partagée que pendant la partie, avec ses seuls participants.",
];
