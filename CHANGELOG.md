# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique.

## [0.3.0] — 2026-11-19

Stabilisation après audit complet, premier APK Android livré (`releases/v0.3.0/`). Build Android : 300.

### Corrigé
- **[P0] Confidentialité** : après une partie, tout participant pouvait lire pendant 30 jours les événements de position (arrondies) de tous les joueurs, y compris de l'équipe adverse. Migration `0900` : ces événements ne sont plus lisibles hors de son équipe après la partie, sont effacés 24 h après la fin (comme les positions brutes), et l'arrêt de sécurité / quitter la partie les efface aussi.
- **[P0] GPS** : un arrêt du suivi pendant son démarrage (fin de partie, changement d'écran rapide) pouvait laisser l'abonnement GPS actif après la partie, ou effacer la partie mémorisée d'un nouveau démarrage. Démarrages/arrêts désormais sérialisés.
- **[P0] Connexion** : un échec réseau au chargement du profil laissait l'application sur « Chargement » indéfiniment. Nouvel écran d'erreur avec « Réessayer » et « Se déconnecter » ; nouvelles tentatives automatiques.
- **[P1] Menus Android tronqués** : `Alert` n'affiche que 3 boutons sur Android. L'hôte ne voyait pas « Exclure » / « Transmettre le rôle d'hôte » dans le lobby, ni toutes les options du menu de partie. Remplacés par une feuille d'actions.
- **[P1] Bouton retour Android en partie** : quittait l'écran de jeu sans prévenir et coupait le partage GPS. Il ouvre désormais le menu de la partie (ou ferme le panneau).
- **[P1] Envoi des positions en rafale** : iOS ignore l'intervalle GPS demandé et les flux premier plan / arrière-plan se cumulent ; le serveur refusait alors des positions (« Position refusée »). Envoi limité à un par intervalle de la partie, la plus récente seulement.
- **[P2] Code d'invitation perdu** : « J'ai un code de salon » ou un lien `traque://join?code=…` ouvert sans être connecté ramenait à l'accueil après connexion. La destination est conservée (connexion → profil → autorisations → salon).
- **[P2] Carte** : propriétés natives recréées toutes les 500 ms (bornes, couches) ; rafraîchissement limité à 1 Hz et valeurs mémorisées. Les boutons de carte ne chevauchent plus le panneau Joueurs/Radar/Journal.
- **[P2] Fin de partie sans vainqueur** : affichage « Égalité » robuste (plus de « Victoire des undefined » possible).
- Avertissements de lint résolus.

### Ajouté
- Message « Fond de carte indisponible » si les tuiles ne se chargent pas (le jeu reste utilisable).
- Option « Sans équipe » dans le menu joueur de l'hôte.
- Version et numéro de build affichés dans Réglages (lus dans l'application installée).
- `npm run release:apk` : vérifications, APK release, contrôles (version, signature, configuration intégrée, absence de secret), dossier `releases/vX.Y.Z/` avec changelog et rapport de build.
- Tests de non-régression : confidentialité des événements (3), limitation d'envoi GPS, destination après connexion (3).

### Modifié
- Version : source unique `apps/mobile/package.json` ; numéro de build dérivé (`MAJEUR*10000 + MINEUR*100 + CORRECTIF`) ; `eas.json` en version locale (les builds EAS et locaux portent le même numéro).
- Dépendance ajoutée : `expo-application`.

## [0.2.0] — 2026-11-18

Migration vers une application mobile Android/iOS de chasse géolocalisée (GPS réel). Audit et plan : docs/MIGRATION_MOBILE_GPS.md.

### Ajouté
- Application Expo SDK 58 (apps/mobile) : 15 écrans, carte MapLibre native + OpenStreetMap (style sombre, fournisseur interchangeable), GPS premier plan / arrière-plan, autorisations, consentement, bouton d'arrêt de sécurité, icônes originales, profils EAS.
- Paquet partagé packages/shared : configuration, règles, géographie, état, contrôleur, couches cartographiques, géocodage.
- Migration 0800 : positions GPS privées, arrondi, consentement obligatoire, zone réelle, sortie de zone, captures par distance, radar GPS (direction/secteur/zone), capacités Leurre et Sonar, arrêt de sécurité, rétention 24 h, anti-triche (vitesse, horodatage).
- Tests GPS, sécurité des positions, simulation 20 joueurs en marche réelle ; test de charge réseau adapté.

### Modifié
- Monorepo npm (workspaces) ; documentation entièrement mise à jour.
- Radar par défaut : direction et distance.

### Retiré
- Client web Next.js et grille virtuelle (conservés : étiquette v0.1.0-web). Fonctions SQL de grille supprimées (move, compute_vis, generate_map…). Capacités Accélération et Blocage désactivées (lignes conservées).

## [0.1.0] — 2026-11-18

Première version (MVP).

### Ajouté
- Projet Next.js 16 en export statique (compatible Cloudflare Pages), TypeScript, Tailwind CSS 4, design system sombre (Abysse / Graphite / Volt).
- Migrations Supabase versionnées :
  - `0100` fondations (schéma `private`, horloge serveur, limitation de fréquence, compteurs d'usage) ;
  - `0200` modèle de données (13 tables, contraintes, index, triggers de profil) ;
  - `0300` catalogue des capacités, normalisation de configuration, génération de carte ;
  - `0400` profils et salons (création, invitation, équipes, hôte, exclusion, heartbeat) ;
  - `0500` moteur de partie (états, déplacements, visibilité, captures, radar, capacités, pause, fin, statistiques, classement, administration) ;
  - `0600` sécurité (RLS, privilèges, autorisation Realtime) ;
  - `0700` rotation du topic Fugitif (mode Infection).
- Modes Classique et Infection ; 6 capacités ; radar configurable.
- Authentification invité et e-mail, profils, statistiques, historique, classement privé.
- Lobby temps réel (présence, événements), interface de jeu (carte canvas, contrôles tactiles et clavier), résultats avec carte des trajets.
- Contrôleur de partie : séquenceur par flux, resynchronisation, horloge serveur, reconnexion.
- PWA (manifeste généré avec le nom provisoire, icônes, service worker), en-têtes de sécurité Cloudflare.
- 87 tests automatisés (Vitest + PGlite), script de test de charge réel, script pg_cron optionnel.
- Documentation : README, SETUP_GUIDE, DEPLOYMENT_GUIDE, TESTING_GUIDE, REMAINING_TASKS, RAPPORT_FINAL, docs/ARCHITECTURE, docs/SECURITY, docs/QUOTAS.

### Corrigé (pendant le développement)
- Les tentatives de code de salon invalides n'étaient pas comptées par la limitation de fréquence (annulation de transaction) : `join_room` renvoie désormais ses échecs sans exception.
- Un joueur infecté pouvait conserver l'écoute du canal Fugitif : rotation du topic.
- Rendu de carte bloqué après un démontage/remontage de composant (animation non réinitialisée).
