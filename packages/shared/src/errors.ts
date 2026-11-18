/** Traduction des codes d'erreur serveur (E_*) en messages lisibles. */
const MESSAGES: Record<string, string> = {
  E_NOT_AUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  E_PROFILE_INCOMPLETE: "Choisissez d'abord un pseudo.",
  E_INVALID_USERNAME: "Pseudo invalide : 2 à 20 caractères (lettres, chiffres, espace, . _ -).",
  E_INVALID_AVATAR: "Avatar invalide.",
  E_USERNAME_TAKEN: "Ce pseudo est déjà utilisé.",
  E_RATE_LIMITED: "Trop d'actions rapprochées. Patientez un instant.",
  E_INVALID_ROOM_NAME: "Le nom du salon doit contenir 2 à 40 caractères.",
  E_TOO_MANY_ROOMS: "Vous hébergez déjà 3 salons ouverts. Fermez-en un d'abord.",
  E_INVALID_CODE: "Code invalide : 6 caractères (lettres et chiffres).",
  E_ROOM_NOT_FOUND: "Salon introuvable ou fermé.",
  E_BANNED: "Vous avez été exclu de ce salon.",
  E_GAME_IN_PROGRESS: "Une partie est en cours dans ce salon. Réessayez à la fin.",
  E_ROOM_FULL: "Ce salon est complet.",
  E_NOT_MEMBER: "Vous ne faites pas (ou plus) partie de ce salon.",
  E_NOT_HOST: "Seul l'hôte peut faire cela.",
  E_CANNOT_KICK_SELF: "Vous ne pouvez pas vous exclure vous-même.",
  E_NOT_IN_LOBBY: "Action impossible pendant une partie.",
  E_INVALID_TEAM: "Équipe invalide.",
  E_TEAM_CHOICE_DISABLED: "L'hôte répartit les équipes dans ce salon.",
  E_NOT_ENOUGH_PLAYERS: "Il faut au moins 2 joueurs.",
  E_TEAMS_INCOMPLETE: "Tous les joueurs doivent avoir une équipe.",
  E_TEAMS_UNBALANCED: "Il faut au moins un Chasseur et un Fugitif.",
  E_INVALID_MAX_PLAYERS: "Nombre maximum de joueurs invalide.",
  E_GAME_NOT_FOUND: "Partie introuvable.",
  E_NOT_PARTICIPANT: "Vous ne participez pas à cette partie.",
  E_NOT_ACTIVE: "Vous n'êtes plus en jeu.",
  E_CANNOT_CAPTURE_NOW: "Capture impossible pour le moment.",
  E_WRONG_TEAM: "Action réservée à l'autre équipe.",
  E_COOLDOWN: "En recharge.",
  E_PHASE: "Action indisponible dans cette phase.",
  E_RADAR_UNAVAILABLE: "Radar indisponible.",
  E_NO_USES_LEFT: "Plus d'utilisation disponible.",
  E_UNKNOWN_ABILITY: "Capacité inconnue.",
  E_ABILITY_DISABLED: "Capacité désactivée pour cette partie.",
  E_INVALID_TRANSITION: "Action impossible dans l'état actuel de la partie.",
  E_TOO_MANY_CONFIGS: "Limite de 20 configurations atteinte.",
  E_FORBIDDEN: "Accès réservé à l'administrateur.",
  E_INTERNAL: "Erreur interne du serveur.",
  E_ZONE_NOT_SET: "Choisissez et validez la zone de jeu sur la carte.",
  E_CONSENT_MISSING: "Chaque joueur doit accepter les consignes et le partage de position.",
  E_CONSENT_REQUIRED: "Acceptez le partage de position pour participer.",
  E_GAME_FINISHED: "La partie est terminée : le partage de position est arrêté.",
  E_INVALID_POSITION: "Position GPS invalide.",
  E_STALE_POSITION: "Position GPS trop ancienne : vérifiez l'heure et le signal.",
  E_IMPLAUSIBLE_SPEED: "Déplacement trop rapide pour être pris en compte.",
  E_POSITION_REQUIRED: "Position GPS récente nécessaire : attendez un signal.",
  E_GPS_IMPRECISE: "Signal GPS trop imprécis pour capturer.",
  E_OUT_OF_ZONE: "Vous êtes hors de la zone de jeu.",
  E_NETWORK: "Connexion impossible. Vérifiez votre réseau.",
  E_NOT_CONFIGURED: "Le serveur n'est pas configuré (variables Supabase manquantes).",
};

export class AppError extends Error {
  constructor(
    public code: string,
    public detail?: string,
  ) {
    super(MESSAGES[code] ?? code);
    this.name = "AppError";
  }
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? "Une erreur inattendue est survenue.";
}

/** Convertit une erreur PostgREST/Supabase en AppError. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as { message?: string; details?: string; code?: string } | null;
  const msg = err?.message ?? "";
  if (/^E_[A-Z_]+$/.test(msg)) return new AppError(msg, err?.details);
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) return new AppError("E_NETWORK", msg);
  const generic = new AppError("E_INTERNAL", msg);
  generic.message = msg ? `Erreur : ${msg}` : messageFor("E_INTERNAL");
  return generic;
}
