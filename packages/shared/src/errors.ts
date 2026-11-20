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
  E_PROFILE_MISSING: "Votre profil est introuvable sur le serveur. Réessayez ou reconnectez-vous.",
  E_NOT_CONFIGURED: "Le serveur n'est pas configuré (variables Supabase manquantes).",
  // v0.4.0 — administration
  E_FORBIDDEN: "Action non autorisée pour votre rôle.",
  E_SUSPENDED: "Votre compte est suspendu temporairement. Consultez vos avis dans le profil.",
  E_REASON_REQUIRED: "Indiquez un motif (3 caractères minimum).",
  E_INVALID_ROLE: "Rôle invalide.",
  E_USER_NOT_FOUND: "Joueur introuvable.",
  E_INVALID_DURATION: "Durée invalide (1 h à 90 jours).",
  E_ALREADY_REVOKED: "Cette sanction est déjà levée.",
  E_INVALID_CATEGORY: "Catégorie de signalement invalide.",
  E_INVALID_STATUS: "Statut invalide.",
  E_INVALID_SETTING: "Paramètre invalide.",
  E_MAX_PLAYERS_LIMIT: "Nombre de joueurs supérieur à la limite fixée par l'administration.",
  E_INVALID_VERSION: "Numéro de version invalide (ex. 0.4.0).",
  E_INVALID_URL: "Le lien de téléchargement doit commencer par https://.",
  E_FEATURE_DISABLED: "Cette fonctionnalité est désactivée par l'administration.",
  E_NOT_FOUND: "Élément introuvable.",
  // v0.4.0 — modes, captures, sécurité
  E_MISTERX_ONE_FUGITIVE: "Mister X : il faut exactement un Fugitif (tous les autres joueurs sont Chasseurs).",
  E_ROYALE_NEEDS_CIRCLE: "Le mode Royale exige une zone circulaire.",
  E_OBJECTIVES_EMPTY: "Objectifs activés : placez au moins une balise ou le point d'extraction.",
  E_OBJECTIVE_OUTSIDE: "Une balise ou l'extraction est hors de la zone de jeu (ou dans une zone interdite).",
  E_SOS_ACTIVE: "Une alerte SOS est en cours : levez-la avant de reprendre.",
  E_NO_SOS: "Aucune alerte SOS en cours.",
  E_CAPTURE_METHOD: "Cette méthode de capture n'est pas autorisée dans cette partie.",
  E_TOKEN_INVALID: "Code de capture invalide.",
  E_TOKEN_USED: "Ce code a déjà servi.",
  E_TOKEN_EXPIRED: "Code expiré : le Fugitif doit afficher un nouveau code.",
  E_TARGET_NOT_ACTIVE: "Ce Fugitif n'est plus en jeu.",
  E_TARGET_EXTRACTED: "Ce Fugitif est exfiltré : il ne peut plus être capturé.",
  E_TOO_FAR: "Capture refusée : vous êtes trop loin de ce Fugitif.",
  E_SPECTATOR: "Spectateur : vous ne pouvez plus agir ni communiquer dans la partie.",
  E_NOT_SPECTATOR: "Réservé aux joueurs capturés.",
  E_INVALID_MESSAGE: "Message inconnu.",
  E_INVALID_MARKER: "Type de repère inconnu.",
  E_MARKER_OUTSIDE: "Repère trop loin de la zone de jeu.",
  E_GAME_NOT_FINISHED: "La partie n'est pas terminée.",
  E_INVALID_STATS: "Valeurs invalides ou incohérentes (aucune modification).",
  E_CONFIRMATION_REQUIRED: "Tapez SUPPRIMER pour confirmer.",
  E_OWNER_CANNOT_DELETE: "Le propriétaire ne peut pas supprimer son compte (transférez d'abord le rôle).",
  E_IN_GAME: "Quittez d'abord la partie en cours.",
  E_EMAIL_NOT_CONFIRMED: "Adresse e-mail pas encore confirmée : saisissez le code reçu par e-mail.",
  E_CODE_INVALID: "Code invalide ou expiré. Demandez un nouveau code.",
  E_REPLAY_EXPIRED: "Le replay n'est plus disponible : les trajets sont effacés 24 h après la partie.",
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
