/**
 * Règles d'affichage dérivées : pas disponibles, machine à états, modes,
 * capacités, radar. Pures et testables (tests/unit).
 */
import type {
  AbilityKey,
  DistanceBand,
  Dir8,
  GameMode,
  GamePhase,
  RadarContact,
  RadarPrecision,
  Team,
} from "./types";

// ---------------------------------------------------------------------------
// Pas (miroir de private.available_steps)
// ---------------------------------------------------------------------------
export function availableSteps(
  p: { steps: number; steps_at: number; boost_until?: number | null },
  cfg: { max_steps: number; step_regen_ms: number },
  now: number,
): { steps: number; nextAt: number | null } {
  let regen = cfg.step_regen_ms;
  if (p.boost_until && p.boost_until > now) regen = Math.max(250, Math.floor(regen / 2));
  const elapsed = Math.max(0, now - p.steps_at);
  const gained = Math.floor(elapsed / regen);
  if (p.steps + gained >= cfg.max_steps) return { steps: cfg.max_steps, nextAt: null };
  return { steps: p.steps + gained, nextAt: p.steps_at + (gained + 1) * regen };
}

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
// Équipes
// ---------------------------------------------------------------------------
export const TEAM_LABEL: Record<Team, string> = { hunter: "Chasseurs", fugitive: "Fugitifs" };
export const TEAM_SINGULAR: Record<Team, string> = { hunter: "Chasseur", fugitive: "Fugitif" };
export function enemyOf(t: Team): Team {
  return t === "hunter" ? "fugitive" : "hunter";
}

// ---------------------------------------------------------------------------
// Modes de jeu (registre extensible)
// ---------------------------------------------------------------------------
export interface ModeInfo {
  id: GameMode | "mister_x" | "royale";
  label: string;
  summary: string;
  available: boolean;
}

export const MODES: ModeInfo[] = [
  {
    id: "classic",
    label: "Classique",
    summary: "Les Chasseurs doivent capturer tous les Fugitifs avant la fin du temps.",
    available: true,
  },
  {
    id: "infection",
    label: "Infection",
    summary: "Chaque Fugitif capturé rejoint les Chasseurs. Les derniers survivants doivent tenir.",
    available: true,
  },
  {
    id: "mister_x",
    label: "Mister X",
    summary: "Un seul Fugitif aux capacités spéciales contre tous les autres.",
    available: false,
  },
  {
    id: "royale",
    label: "Royale",
    summary: "Une zone se resserre : restez à l'intérieur pour survivre.",
    available: false,
  },
];

// ---------------------------------------------------------------------------
// Capacités : métadonnées d'interface (les chiffres viennent du serveur)
// ---------------------------------------------------------------------------
export interface AbilityMeta {
  key: AbilityKey;
  team: Team;
  name: string;
  short: string;
  targeting: "none" | "cell";
  range?: number;
}

export const ABILITIES: Record<AbilityKey, AbilityMeta> = {
  ghost: { key: "ghost", team: "fugitive", name: "Fantôme", short: "Invisible sur la carte adverse", targeting: "none" },
  jammer: { key: "jammer", team: "fugitive", name: "Brouilleur", short: "Brouille radar et Traqueur", targeting: "none" },
  sprint: { key: "sprint", team: "fugitive", name: "Accélération", short: "+2 pas, régénération ×2", targeting: "none" },
  scan: { key: "scan", team: "hunter", name: "Scan", short: "Révèle une zone ciblée", targeting: "cell", range: 7 },
  tracker: { key: "tracker", team: "hunter", name: "Traqueur", short: "Cap vers le Fugitif le plus proche", targeting: "none" },
  barrier: { key: "barrier", team: "hunter", name: "Blocage", short: "Ferme une case", targeting: "cell", range: 4 },
};

export function abilitiesFor(team: Team): AbilityMeta[] {
  return Object.values(ABILITIES).filter((a) => a.team === team);
}

// ---------------------------------------------------------------------------
// Radar : présentation des contacts
// ---------------------------------------------------------------------------
export const DIR_LABEL: Record<Dir8, string> = {
  N: "Nord",
  NE: "Nord-Est",
  E: "Est",
  SE: "Sud-Est",
  S: "Sud",
  SW: "Sud-Ouest",
  W: "Ouest",
  NW: "Nord-Ouest",
  here: "Sur place",
};

export const DIR_ANGLE: Record<Exclude<Dir8, "here">, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

export const BAND_LABEL: Record<DistanceBand, string> = { near: "proche", mid: "à moyenne distance", far: "loin" };

export const PRECISION_LABEL: Record<RadarPrecision, string> = {
  direction: "Indice directionnel",
  sector: "Secteur approximatif",
  zone: "Zone approximative",
};

export function sectorName(sx: number, sy: number): string {
  return `${"ABCDEFGH"[sx] ?? "?"}${sy + 1}`;
}

export function describeContact(c: RadarContact): string {
  if ("jammed" in c) return "Signal brouillé";
  if ("dir" in c) return c.dir === "here" ? "Signal tout proche" : `${DIR_LABEL[c.dir]}, ${BAND_LABEL[c.band]}`;
  if ("sx" in c) return `Secteur ${sectorName(c.sx, c.sy)}`;
  return `Zone ${c.size}×${c.size}`;
}

/** Rectangle de carte couvert par un contact (secteur/zone), sinon null. */
export function contactRect(c: RadarContact): { x: number; y: number; w: number; h: number } | null {
  if ("sx" in c) return { x: c.sx * c.size, y: c.sy * c.size, w: c.size, h: c.size };
  if ("x0" in c) return { x: c.x0, y: c.y0, w: c.size, h: c.size };
  return null;
}

// ---------------------------------------------------------------------------
// Temps
// ---------------------------------------------------------------------------
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
