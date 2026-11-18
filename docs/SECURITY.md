# Sécurité, confidentialité et sûreté (v0.2 — GPS réel)

## Données de localisation

| Mesure | Mise en œuvre |
|--------|---------------|
| Partage uniquement pendant une partie | le serveur refuse toute position hors partie active (`E_GAME_FINISHED`, `E_NOT_ACTIVE`) ; l'application n'active le GPS que sur l'écran de jeu d'une partie active |
| Consentement explicite | accord dans le lobby (`set_location_consent`), exigé par `start_game` et `report_position` ; toute modification des règles annule les accords |
| Positions brutes protégées | tables `private.player_positions` / `private.position_history` : schéma non exposé par l'API, aucun droit pour les rôles clients (testé) |
| Affichage approximatif | coéquipiers ~10 m, adversaires `max(approx_m, précision GPS)` sur une grille stable ; jamais plus précis que le GPS réel |
| Fréquence limitée | envoi ≥ 3 s (5 s par défaut), diffusion aux adversaires ≤ 1 fois / `enemy_refresh_s` |
| Accès réservé | canaux Realtime privés par audience, RLS ; le flux public ne contient jamais de coordonnées (testé) |
| Rétention | positions brutes effacées 24 h après la fin de partie (`private.cleanup`, quotidien si pg_cron activé) ; historique approximatif des événements supprimé après 30 jours |
| Retrait immédiat | `safety_stop` / `leave_game` : sortie de partie + effacement des positions brutes du joueur + arrêt du GPS |
| Pas de suivi hors jeu | aucune fonction de localisation en dehors des parties ; suivi orphelin coupé au démarrage de l'application ; déconnexion = arrêt |

## Sûreté dans le monde réel (intégrée au produit)

- Consignes affichées et acceptées avant chaque partie (espaces publics, pas de propriété privée, pas de course sur la chaussée, zone, arrêt possible).
- Capture **sans contact** (proximité GPS) : aucune incitation à attraper physiquement quelqu'un.
- Vitesse > 43 km/h (réglable) refusée : décourage les véhicules.
- Zone limitée et visible ; sortie signalée ; fin ou pause immédiate par l'hôte ; bouton **Arrêt** permanent pour chaque joueur.
- Aucun objectif imposé dans un lieu précis.

## Contrôles applicatifs (repris de v0.1, toujours testés)

RLS sur toutes les tables, aucune écriture directe, fonctions privées non exécutables, rôle anonyme sans droit, limitation de fréquence (dont anti-force brute des codes), verrous par partie, rotation du topic Fugitif (Infection), séquences contiguës.

## Secrets

L'application ne contient que l'URL et la clé **publique** Supabase. La session est dans le trousseau sécurisé (Keychain / Keystore). Aucune clé `service_role` / *secret key* ne doit être placée dans `apps/mobile/.env`, dans EAS ou dans le dépôt.

## Limites connues

- La précision réelle dépend du téléphone et de l'environnement (immeubles, intérieur) ; une précision > `max_accuracy_m` empêche de capturer.
- Un joueur peut fausser son GPS (applications de position simulée) : la vitesse implausible est bloquée, pas une téléportation lente. Pour un jeu entre amis, c'est accepté et documenté.
- Les membres d'une même équipe se voient à ~10 m : c'est voulu (coordination).
- Les données transitent par les serveurs Supabase (région choisie à la création du projet) et les tuiles par le fournisseur cartographique (qui voit les zones consultées, pas les positions des joueurs).
