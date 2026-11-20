# Sécurité, confidentialité et sûreté (v0.4 — GPS réel, administration)

## Données de localisation

| Mesure | Mise en œuvre |
|--------|---------------|
| Partage uniquement pendant une partie | le serveur refuse toute position hors partie active (`E_GAME_FINISHED`, `E_NOT_ACTIVE`) ; l'application n'active le GPS que sur l'écran de jeu d'une partie active |
| Consentement explicite | accord dans le lobby (`set_location_consent`), exigé par `start_game` et `report_position` ; toute modification des règles annule les accords |
| Positions brutes protégées | tables `private.player_positions` / `private.position_history` : schéma non exposé par l'API, aucun droit pour les rôles clients (testé) |
| Affichage approximatif | coéquipiers ~10 m, adversaires `max(approx_m, précision GPS)` sur une grille stable ; jamais plus précis que le GPS réel |
| Fréquence limitée | envoi ≥ 3 s (5 s par défaut), diffusion aux adversaires ≤ 1 fois / `enemy_refresh_s` |
| Accès réservé | canaux Realtime privés par audience, RLS ; le flux public ne contient jamais de coordonnées (testé) |
| Rétention | positions brutes **et événements porteurs de position** (`pos`, `enemy_pos`, radar, révélations…) effacés 24 h après la fin de partie (`private.cleanup`, quotidien via pg_cron) ; autres événements (captures, statuts, fin) supprimés après 30 jours. Après la partie, un joueur ne lit que les événements sans position des autres équipes (migration 0900). Arrêt de sécurité / quitter : positions et événements de position du joueur effacés immédiatement. Les messages Realtime transitoires (`realtime.messages`) sont purgés par Supabase sous quelques jours. |
| Retrait immédiat | `safety_stop` / `leave_game` : sortie de partie + effacement des positions brutes du joueur + arrêt du GPS |
| Pas de suivi hors jeu | aucune fonction de localisation en dehors des parties ; suivi orphelin coupé au démarrage de l'application ; déconnexion = arrêt |

## Administration (v0.4.0, migration 1000)

| Mesure | Mise en œuvre |
|--------|---------------|
| Rôles vérifiés côté serveur | `private.require_role()` dans chaque RPC `admin_*` ; propriétaire unique (index), seul à attribuer les rôles ; on ne sanctionne jamais un rang égal ou supérieur ni soi-même |
| Traçabilité | motif obligatoire ; `public.admin_audit` (auteur, rôle, action, cible, motif, résultat) non lisible directement, consultable par RPC |
| Pas de triche possible | aucune RPC d'administration ne lit `private.player_positions`, ne capture, ne déplace, ne modifie un score ; `admin_game_detail` ne renvoie aucune coordonnée (testé) ; une partie terminée par l'administration est **non comptée** |
| Transparence | pause / reprise / fin par l'administration annoncées à tous les joueurs (`admin_action`) |
| Sanctions | avertissement, suspension (modérateur ≤ 72 h) ; suspendu = plus de création ni d'adhésion à un salon ; le joueur voit ses avis |
| Signalements | jamais montrés au joueur visé ; notes internes et décision journalisées |
| Données sensibles | `sanctions`, `reports`, `report_notes`, `app_releases`, `app_settings` : aucun droit client direct ; erreurs remontées par l'application dans `private.client_errors` (14 jours) |

## Nouvelles données de la v0.4.0

| Donnée | Visibilité | Rétention |
|--------|-----------|-----------|
| Révélation Mister X (position exacte arrondie à ~1 m) | Chasseurs de la partie uniquement | effacée 24 h après la partie (événement positionnel + colonne) |
| Alerte SOS (position exacte **seulement si le joueur l'accepte**) | participants de la partie | événement positionnel : 24 h |
| Repères d'équipe (lieu choisi) | équipe du joueur | 24 h après la partie |
| Batterie, application au premier plan, état GPS | coéquipiers seulement | état courant de la partie |
| Vue spectateur | joueurs capturés : positions **différées** (3 min par défaut) arrondies à ≥ 50 m | calculée à la demande |
| Replay | participants seulement, trajets arrondis à 10 m, 1 point / 10 s, si l'hôte l'active (mentionné dans les règles acceptées) | 24 h (positions brutes effacées ensuite) |
| Jetons de capture QR | jamais lisibles (haché SHA-256), 45 s, usage unique | supprimés 1 h après expiration |

Rotation des canaux d'équipe : à chaque capture ou départ, le topic Realtime de l'équipe change ; un joueur qui n'est plus actif ne peut plus le rejoindre (`can_access_topic`, testé).

## Sûreté dans le monde réel (intégrée au produit)

- **SOS** : pause immédiate de la partie pour tous, alerte et message, partage de position sur accord explicite, reprise impossible avant levée ; rappel permanent : Manhunt n'est pas un service d'urgence, appeler le 112.
- **GPS muet** signalé à tous (sécurité), jamais sanctionné.
- **Heure de fin et point de rendez-vous** affichés pendant la partie.
- Balises et extraction placées **par l'hôte**, avec rappel : lieux publics, accessibles, sans route à traverser ni propriété privée. Zones interdites dessinées par l'hôte (l'exclusion automatique des routes n'est pas disponible).

- Consignes affichées et acceptées avant chaque partie (espaces publics, pas de propriété privée, pas de course sur la chaussée, zone, arrêt possible).
- Capture **sans contact** (proximité GPS) : aucune incitation à attraper physiquement quelqu'un.
- Vitesse > 43 km/h (réglable) refusée : décourage les véhicules.
- Zone limitée et visible ; sortie signalée ; fin ou pause immédiate par l'hôte ; bouton **Arrêt** permanent pour chaque joueur.
- Aucun objectif placé automatiquement : balises et extraction sont toujours choisies par l'hôte.

## Contrôles applicatifs (repris de v0.1, toujours testés)

RLS sur toutes les tables, aucune écriture directe, fonctions privées non exécutables, rôle anonyme sans droit, limitation de fréquence (dont anti-force brute des codes), verrous par partie, rotation du topic Fugitif (Infection), séquences contiguës.

## Secrets

L'application ne contient que l'URL et la clé **publique** Supabase. La session est dans le trousseau sécurisé (Keychain / Keystore). Aucune clé `service_role` / *secret key* ne doit être placée dans `apps/mobile/.env`, dans EAS ou dans le dépôt.

## Limites connues

- La précision réelle dépend du téléphone et de l'environnement (immeubles, intérieur) ; une précision > `max_accuracy_m` empêche de capturer.
- Un joueur peut fausser son GPS (applications de position simulée) : la vitesse implausible est bloquée, pas une téléportation lente. Pour un jeu entre amis, c'est accepté et documenté.
- Les membres d'une même équipe se voient à ~10 m : c'est voulu (coordination).
- Les données transitent par les serveurs Supabase (région choisie à la création du projet) et les tuiles par le fournisseur cartographique (qui voit les zones consultées, pas les positions des joueurs).
