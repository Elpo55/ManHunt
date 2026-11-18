/** Texte lisible des événements de partie (journal + notifications). */
import { ABILITIES, BAND_LABEL, DIR_LABEL, TEAM_LABEL, describeContact } from "./rules";
import type { AbilityKey, GameEvent, RadarContact, Team } from "./types";
import type { GameState } from "./state";

export type Tone = "neutral" | "hunter" | "fugitive" | "alert" | "accent";
export interface JournalLine {
  text: string;
  tone: Tone;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = ev.d as Record<string, any>;
  const name = (u: string) => (u === s.me.u ? "Vous" : (s.players[u]?.username ?? "Un joueur"));
  switch (ev.t) {
    case "phase_changed":
      if (d.phase === "preparation") return { text: "Préparation : les Fugitifs se dispersent.", tone: "accent" };
      if (d.phase === "running") return { text: "La traque commence.", tone: "accent", notify: true };
      if (d.phase === "paused") return { text: "Partie en pause.", tone: "alert", notify: true };
      return null;
    case "player_status":
      if (d.status === "abandoned")
        return { text: d.reason === "safety" ? `${name(d.u)} a arrêté le partage (sécurité).` : `${name(d.u)} a quitté la partie.`, tone: "neutral", notify: true };
      if (d.connected === false) return { text: `${name(d.u)} a perdu la connexion.`, tone: "neutral" };
      if (d.connected === true) return { text: `${name(d.u)} est de retour.`, tone: "neutral" };
      return null;
    case "zone_status":
      return d.out
        ? { text: `${name(d.u)} est sorti de la zone de jeu.`, tone: "alert", notify: d.u === s.me.u }
        : { text: `${name(d.u)} est revenu dans la zone.`, tone: "neutral" };
    case "capture":
      if (d.reason === "out_of_zone") return { text: `${name(d.f)} est éliminé : sorti de la zone trop longtemps.`, tone: "hunter", notify: true };
      if (d.infected) return { text: `${name(d.h)} a infecté ${name(d.f)}.`, tone: "hunter", notify: true };
      return {
        text: d.f === s.me.u ? `Vous avez été capturé par ${name(d.h)}.` : `${name(d.h)} a capturé ${name(d.f)}.`,
        tone: "hunter",
        notify: true,
      };
    case "capture_missed":
      return { text: "Capture manquée : aucun Fugitif assez proche.", tone: "neutral" };
    case "team_changed":
      return { text: `Vous rejoignez les ${TEAM_LABEL[d.team as Team]}.`, tone: "hunter", notify: true };
    case "position_withdrawn":
      return { text: `${name(d.u)} ne partage plus sa position.`, tone: "neutral" };
    case "radar": {
      const contacts = (d.contacts ?? []) as RadarContact[];
      if (!contacts.length) return { text: "Radar : aucun adversaire actif.", tone: "accent", notify: true };
      const first = contacts.slice(0, 3).map(describeContact).join(" · ");
      return { text: `Radar : ${first}${contacts.length > 3 ? "…" : ""}`, tone: "accent", notify: true };
    }
    case "radar_ping":
      return { text: "Impulsion radar adverse détectée.", tone: "alert", notify: true };
    case "reveal": {
      const n = (d.contacts ?? []).length;
      return { text: `${name(d.by)} : Scan — ${n} Fugitif${n > 1 ? "s" : ""} à moins de ${d.radius_m} m.`, tone: "accent", notify: true };
    }
    case "tracker":
      if (d.none) return { text: "Traqueur : aucun Fugitif localisé.", tone: "accent", notify: true };
      if (d.jammed) return { text: "Traqueur : signal brouillé.", tone: "alert", notify: true };
      return { text: `Traqueur : ${DIR_LABEL[d.dir as keyof typeof DIR_LABEL]}, ${BAND_LABEL[d.band as keyof typeof BAND_LABEL]} (~${d.dist_m} m).`, tone: "accent", notify: true };
    case "sonar":
      return { text: `Sonar : ${d.count} Fugitif${d.count > 1 ? "s" : ""} à moins de ${d.radius_m} m.`, tone: "accent", notify: true };
    case "ability": {
      const a = ABILITIES[d.key as AbilityKey];
      return a ? { text: `${name(d.u)} : ${a.name}.`, tone: a.team } : null;
    }
    case "alert":
      return d.kind === "scanned" ? { text: "Vous avez été repéré par un Scan !", tone: "alert", notify: true } : null;
    case "game_finished": {
      const w = d.winner as Team | "draw";
      return { text: `${w === "draw" ? "Égalité" : `Victoire des ${TEAM_LABEL[w]}`} : ${REASON[d.reason] ?? d.reason}.`, tone: "accent", notify: true };
    }
    default:
      return null;
  }
}
