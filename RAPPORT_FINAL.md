# Rapport final — v0.2 « Projet Traque » mobile GPS

Date : 18 novembre 2026.

## 1. Fonctionnalités réalisées

- **Application mobile Expo (Android/iOS)**, 15 écrans : accueil, connexion, création de profil, profil + historique, autorisations GPS, réglages (+ administration), classement, créer / rejoindre un salon, lobby, règles et zone, jeu plein écran, résultats.
- **GPS réel** : autorisations expliquées puis demandées ; premier plan (`watchPositionAsync`) + arrière-plan (tâche, service de premier plan Android, « Toujours » iOS) ; envoi de la seule position la plus récente, recalée sur l'horloge serveur ; arrêt automatique (fin, élimination, arrêt de sécurité, déconnexion, sortie de l'écran, suivi orphelin au démarrage) ; état du partage affiché en permanence.
- **Carte réelle** MapLibre natif + OpenStreetMap, style sombre original, fournisseur interchangeable ; zone de jeu choisie par recherche/déplacement ; joueurs, cercles de précision, positions obsolètes grisées, radar (caps, secteurs, zones, anneau d'impulsion), anneau de capture.
- **Serveur GPS autoritaire** : validation des positions (consentement, phase, bornes, horodatage, ordre, vitesse), zone et sortie de zone, captures par distance, radar, 6 capacités GPS, arrondi des positions, rétention, arrêt de sécurité.
- **Sécurité dans le monde réel** : consignes + consentement obligatoires (bloquant côté serveur), capture sans contact, bouton Arrêt, pause/fin par l'hôte, zone délimitée.
- **Conservé de v0.1** : profils, salons, codes, lobby temps réel, équipes, hôte, Classique, Infection, chronomètre serveur, victoire/égalité/abandon, statistiques, historique, classement, resynchronisation, sécurité RLS/Realtime.

## 2. Architecture technique finale

Monorepo npm : `apps/mobile` (Expo SDK 58, React Native 0.88, Expo Router, expo-location/task-manager, MapLibre RN 11, supabase-js, secure-store) · `packages/shared` (logique pure) · `supabase/migrations` 0100→0800 · tests Vitest/PGlite. Détails : docs/ARCHITECTURE.md, docs/SECURITY.md, docs/QUOTAS.md, docs/MIGRATION_MOBILE_GPS.md.

**Tests exécutés** : 78/78 (25 unitaires, 53 base de données dont simulation GPS 20 joueurs : 754 positions, 14 captures, 0 erreur interne, ~32 messages Realtime/s) ; typage (racine, shared, mobile) ; lint (0 erreur, 3 avertissements documentés) ; `expo-doctor` 20/20 ; bundles Metro Android et iOS compilés (Hermes).

**Non exécuté (impossible sans vos comptes/appareils)** : compilation native, installation, GPS réel, arrière-plan, carte sur appareil, test de charge réseau, partie réelle.

**Déploiement** : aucun. Coûts engagés : 0 €.

## 3. Restant et problèmes identifiés

Non développé : modes **Mister X** et **Royale** (prévus dans la configuration, non sélectionnables) ; notifications push hors application (bannières et vibrations en jeu seulement) ; mises à jour OTA (EAS Update) ; avatars image ; test end-to-end automatisé sur appareil.

Retiré volontairement : client web (conservé : `v0.1.0-web`), capacités Accélération et Blocage (non pertinentes dans le monde réel, lignes conservées désactivées).

Points d'attention :
- **Arrière-plan** : dépend de l'OS et du constructeur ; iOS peut espacer les mises à jour ; une application fermée par l'utilisateur ne suit plus. Repli prévu (écran allumé, signalement « obsolète », abandon après délai).
- **Précision GPS** : en ville dense ou à l'intérieur, > 35 m bloque la capture (réglable).
- **Fausses positions** : téléportation bloquée (vitesse), simulation lente non détectable — acceptable entre amis.
- **iOS** : installation sur iPhone impossible sans compte Apple payant ou Mac (décision à prendre).
- **OpenFreeMap** sans garantie de service : basculer sur MapTiler si besoin.
- Code natif non exécuté sur appareil : écarts possibles de l'API MapLibre/Expo à l'exécution ; à valider au premier test.
- `resume_game` ne prolonge pas la durée du Leurre pendant une pause (effet mineur).

## 4. Vos manipulations, dans l'ordre

1. Créer le projet **Supabase** (SETUP §1.1) et noter URL + clé publique.
2. **Appliquer les migrations** : `npx supabase link …` puis `npx supabase db push`.
3. **Authentification** : invité ON, confirmation e-mail OFF.
4. **Realtime** : désactiver l'accès public.
5. **pg_cron** : activer + exécuter `supabase/optional/pg_cron_jobs.sql`.
6. Créer `apps/mobile/.env` (URL, clé, `APP_BUNDLE_ID`).
7. `npm test` puis `npm run test:load` (contrôle serveur réel).
8. Créer le compte **Expo**, `npx eas-cli login`, `npx eas-cli init`, ajouter les variables EAS.
9. `npx eas-cli build --profile development --platform android`, installer l'APK, sauvegarder le keystore.
10. Réglages Android : localisation « Toujours » + exacte, batterie non restreinte.
11. Première connexion → compte **administrateur** (SQL).
12. Tests un téléphone puis deux téléphones (TESTING_GUIDE §3–6).
13. Build `preview` Android et partie réelle dans un parc avec la fiche de relevé (§7).
14. **Décider pour iOS** (99 $/an ou Mac), puis builds iOS (SETUP §6).
15. (Facultatif) GitHub privé, MapTiler, politique de confidentialité, stores.

Le détail de chaque étape (menus, vérifications) est dans **REMAINING_TASKS.md**.
