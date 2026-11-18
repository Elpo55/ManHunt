# Rapport final — MVP « Projet Traque » (nom provisoire)

Date : 18 novembre 2026.

## Fonctionnalités développées

- **Comptes** : invité (anonyme) et e-mail/mot de passe, liaison invité → e-mail, pseudo unique, emblèmes générés, onboarding.
- **Salons** : création (3 préréglages + configurations enregistrées), code à 6 caractères, lien d'invitation (partage natif / copie), présence en ligne, prêt, équipes (choix libre ou imposé), répartition aléatoire au ratio, exclusion / bannissement, transfert d'hôte manuel et automatique, retour au lobby.
- **Configuration** : mode, durée, préparation, taille et densité de carte, zones interdites, pas (réserve, régénération), vision par équipe, portée et recharge de capture, délai d'abandon, radar complet, chaque capacité (activation, durée, recharge, utilisations), configurations sauvegardées (20 max).
- **Moteur serveur** : machine à états (lobby → préparation → partie ⇄ pause → fin → résultats), génération de carte connexe, apparitions, déplacements validés, brouillard de guerre, captures, conditions de victoire, égalités, abandons, déconnexions avec délai de grâce, statistiques et agrégats de profil.
- **Modes** : Classique et Infection (bonus, simple grâce à l'architecture). Mister X et Royale : non développés, prévus.
- **Radar** : automatique/manuel, direction/secteur/zone, équipes équipées, intervalle, recharge, utilisations, durée d'affichage, brouillage, alerte de l'équipe adverse, anti-doublon.
- **Capacités** : Fantôme, Brouilleur, Accélération, Scan, Traqueur, Blocage.
- **Temps réel** : canaux privés par audience, séquences par flux, détection de doublons/retards/trous, resynchronisation complète, reconnexion avec backoff, horloge serveur, heartbeat, échéances résolues sans serveur permanent.
- **Interface** : 17 pages (accueil, connexion, callback, création de profil, profil, création de salon, rejoindre, lobby, configuration, équipes, jeu, tableau des scores, résultats, statistiques, classement, réglages, aperçu de développement), carte canvas tactile (toucher pour se déplacer, pas à pas, zoom, glisser), dock d'actions avec recharges, journal, panneaux joueurs/radar/scores, mise en page desktop à trois colonnes, PWA installable, vibrations, réduction des animations.
- **Administration** : consommation estimée (base, messages Realtime par jour/mois), nettoyage des anciennes données.

## Fonctionnalités non développées

- Modes **Mister X** et **Royale** (affichés « Prochainement », non sélectionnables).
- Capacités **Leurre**, **Sonar**, **Drone** (non incluses dans le MVP, volontairement).
- Notifications push hors application, chat, sons.
- Avatars personnalisés par image (remplacés par des emblèmes générés, sans stockage).
- Tests de bout en bout automatisés dans un navigateur contre un vrai backend.

## Tests réussis (exécutés)

| Suite | Tests | Résultat |
|-------|------:|----------|
| Unitaires moteur client (grille, chemins, vision, pas, états, radar, config, séquenceur, horloge, état de partie, contrôleur) | 29 | ✅ |
| Base de données — salons et profils | 19 | ✅ |
| Base de données — moteur de jeu, radar, capacités, Infection | 22 | ✅ |
| Base de données — sécurité (RLS, colonnes, Realtime, fuites) | 13 | ✅ |
| Parité configuration TS ↔ SQL | 2 | ✅ |
| Simulation 20 joueurs (240 s, ~1 200 actions) | 1 | ✅ |
| Tâches pg_cron optionnelles | 1 | ✅ |
| **Total** | **87** | **✅ 87/87** |

Plus : typecheck TypeScript ✅, ESLint 0 erreur (6 avertissements documentés : chargement de données au montage), build de production statique ✅, contrôle visuel des écrans (captures headless) ✅.

Mesures de la simulation (PostgreSQL embarqué, sans réseau) : 1 084 actions acceptées, 116 refusées pour raisons de règles (recharge, pas insuffisants), 0 erreur interne, 8 impulsions radar, ≈ 55 livraisons Realtime/s estimées, RPC p50 2,8 ms / p95 4,3 ms (temps de calcul seul, non représentatif du réseau).

## Tests échoués / non réalisés

- Aucun test automatisé en échec.
- **Non réalisés** (nécessitent vos comptes/appareils) : test de charge réseau réel (`scripts/load-test.mjs`, prêt), tests manuels multi-téléphones, vérification sur iOS/Android réels, test sur le projet Supabase réel (les migrations ont été validées sur PostgreSQL 18 via PGlite avec des substituts Supabase ; Supabase utilise PostgreSQL 17 — aucune fonctionnalité spécifique à la v18 n'est utilisée).

## Problèmes connus

- Les substituts de test reproduisent `auth`/`realtime` de Supabase de façon minimale : un écart de comportement de Realtime en production reste possible ; le test de charge réel est là pour le détecter.
- Sans `pg_cron`, une partie dont **tous** les joueurs ont fermé l'application ne se termine qu'au retour du premier joueur (puis le nettoyage clôt les parties inactives > 6 h).
- Les captures headless ont été faites à 500 px de large minimum (limite de Chrome headless) ; l'affichage à 360–390 px est conçu mais doit être confirmé sur un vrai téléphone.
- Un joueur capturé (Classique) reste spectateur de son équipe.
- Le classement « Tous les joueurs » inclut tous les profils de l'instance (instance privée).

## Sécurité

RLS sur toutes les tables, privilèges minimaux, aucun accès anonyme, fonctions internes non exposées, toutes les actions validées et verrouillées côté serveur, canaux Realtime privés autorisés par politique, rotation du topic Fugitif en mode Infection (faille identifiée et corrigée pendant la revue), limitation de fréquence (dont anti-force brute des codes de salon, corrigée pour compter les échecs), en-têtes de sécurité et CSP. Aucune clé secrète dans le code. Détails : [docs/SECURITY.md](docs/SECURITY.md).

## État du déploiement

- Code : dépôt Git local, branche `main`, commits logiques. **Non poussé** sur GitHub (nécessite votre compte).
- Supabase : **non créé** (nécessite votre compte).
- Cloudflare Pages : **non déployé** (nécessite votre compte).
- Toutes les étapes sont détaillées dans [REMAINING_TASKS.md](REMAINING_TASKS.md).

## Coûts prévisibles

**0 €** avec Supabase Free + Cloudflare Pages Free + GitHub. Aucune facturation automatique possible sur ces forfaits gratuits. Seul « coût » : la mise en pause du projet Supabase après ~7 jours d'inactivité (relance manuelle gratuite).

## Limites des services gratuits

Voir [docs/QUOTAS.md](docs/QUOTAS.md) : 200 connexions Realtime simultanées, 100 messages/s, ~2 M messages/mois (à confirmer sur la page tarifaire), ~500 Mo de base, 500 builds Cloudflare/mois. Le jeu à 20 joueurs se situe autour de 55 messages/s en jeu actif.

## Prochaines améliorations recommandées

1. Lancer le test de charge réel et une première soirée de test ; ajuster régénération des pas et intervalle radar selon les mesures.
2. Mode **Mister X** (un Fugitif, capacités dédiées, révélation périodique de sa zone).
3. Mode **Royale** (zone qui se resserre gérée par `tick`).
4. Capacités Leurre et Sonar.
5. Tests de bout en bout Playwright contre un projet Supabase de préproduction.
6. Notifications push (Web Push) pour le lancement d'une partie.
7. Rejeu animé de la partie à partir de l'historique (les données sont déjà stockées).
