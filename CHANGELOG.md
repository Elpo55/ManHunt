# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique.

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
