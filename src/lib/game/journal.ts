/** Texte lisible des événements de partie (journal + notifications). */
import { ABILITIES, BAND_LABEL, DIR_LABEL, PHASE_LABEL, TEAM_LABEL, describeContact } from "../engine/rules";
import type { AbilityKey, GameEvent, Team } from "../engine/types";
import type { GameState } from "./state";

export type Tone = "neutral" | "hunter" | "fugitive" | "alert" | "accent";

export interface JournalLine {
  text: string;
  tone: Tone;
  /** à notifier (toast + vibration) */
  notify?: boolean;
}

const REASON: Record<string, string> = {
  all_captured: "tous les Fugitifs ont été capturés",
  time_up: "le temps est écoulé",
  hunters_left: "tous les Chasseurs ont quitté la partie",
  fugitives_left: "tous les Fugitifs ont quitté la partie",
  aborted: "l'hôte a interrompu la partie",
  no_players: "plus aucun joueur actif",
};

export function describeEvent(ev: GameEvent, s: GameState): JournalLine | null {
// Charges utiles dynamiques (format défini par le serveur, cf. migration 0500).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = ev.d as Record<string, any>;
  const name = (u: string) => (u === s.me.u ? "Vous" : (s.players[u]?.username ?? "Un joueur"));
  switch (ev.t) {
    case "phase_changed":
      if (d.phase === "preparation") return { text: "Préparation : les Fugitifs se cachent.", tone: "accent" };
      if (d.phase === "running") return { text: "La traque commence.", tone: "accent", notify: true };
      if (d.phase === "paused") return { text: "Partie en pause.", tone: "alert", notify: true };
      return null;
    case "player_status":
      if (d.status === "abandoned") return { text: `${name(d.u)} a quitté la partie.`, tone: "neutral", notify: true };
      if (d.connected === false) return { text: `${name(d.u)} est déconnecté.`, tone: "neutral" };
      if (d.connected === true) return { text: `${name(d.u)} est de retour.`, tone: "neutral" };
      return null;
    case "capture":
      if (d.infected) return { text: `${name(d.h)} a infecté ${name(d.f) === "Vous" ? "vous" : name(d.f)}.`, tone: "hunter", notify: true };
      return {
        text: d.f === s.me.u ? `Vous avez été capturé par ${name(d.h)}.` : `${name(d.h)} a capturé ${name(d.f)}.`,
        tone: "hunter",
        notify: true,
      };
    case "capture_missed":
      return { text: "Capture manquée : personne à portée.", tone: "neutral", notify: true };
    case "team_changed":
      return { text: `Vous rejoignez les ${TEAM_LABEL[d.team as Team]}.`, tone: "hunter", notify: true };
    case "map_effect":
      return { text: "Une case vient d'être bloquée.", tone: "alert" };
    case "radar": {
      const contacts = (d.contacts ?? []) as Parameters<typeof describeContact>[0][];
      if (!contacts.length) return { text: "Radar : aucun contact.", tone: "accent", notify: true };
      const first = contacts.slice(0, 3).map(describeContact).join(" · ");
      return {
        text: `Radar : ${contacts.length} contact${contacts.length > 1 ? "s" : ""} — ${first}${contacts.length > 3 ? "…" : ""}`,
        tone: "accent",
        notify: true,
      };
    }
    case "radar_ping":
      return { text: "Impulsion radar adverse détectée.", tone: "alert", notify: true };
    case "reveal":
      return {
        text: `${name(d.by)} : Scan — ${(d.contacts ?? []).length} Fugitif${(d.contacts ?? []).length > 1 ? "s" : ""} repéré${(d.contacts ?? []).length > 1 ? "s" : ""}.`,
        tone: "accent",
        notify: true,
      };
    case "tracker":
      if (d.none) return { text: "Traqueur : aucun Fugitif actif.", tone: "accent", notify: true };
      if (d.jammed) return { text: "Traqueur : signal brouillé.", tone: "alert", notify: true };
      return { text: `Traqueur : ${DIR_LABEL[d.dir as keyof typeof DIR_LABEL]}, ${BAND_LABEL[d.band as keyof typeof BAND_LABEL]}.`, tone: "accent", notify: true };
    case "ability": {
      const a = ABILITIES[d.key as AbilityKey];
      return a ? { text: `${name(d.u)} : ${a.name}.`, tone: a.team } : null;
    }
    case "alert":
      if (d.kind === "scanned") return { text: "Vous avez été repéré par un Scan !", tone: "alert", notify: true };
      return null;
    case "game_finished": {
      const w = d.winner as Team | "draw";
      const head = w === "draw" ? "Égalité" : `Victoire des ${TEAM_LABEL[w]}`;
      return { text: `${head} : ${REASON[d.reason] ?? d.reason}.`, tone: "accent", notify: true };
    }
    default:
      return null;
  }
}

export { PHASE_LABEL };
