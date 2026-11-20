# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique.

## [0.5.0] — 2026-11-21

Comptes e-mail vérifiés par code, correction des statistiques par le propriétaire, confidentialité (RGPD). Build Android : 500.

### Ajouté
- **Code à 6 chiffres par e-mail** à la création d'un compte (le compte n'est actif qu'après saisie du code, renvoi possible après 60 s, code valable 15 min). Connexion ensuite par mot de passe ; un compte jamais confirmé redemande un code.
- **Mot de passe oublié** : code par e-mail puis nouveau mot de passe.
- **Invité → compte e-mail** : l'adresse liée est confirmée par code.
- E-mails envoyés en français depuis un compte Gmail dédié (SMTP configuré sur Supabase, 30 e-mails/h).
- **Administration — correction des statistiques et des succès** (propriétaire uniquement) : valeurs contrôlées (entiers ≥ 0, cohérence parties/victoires/séries), motif obligatoire, journal avant/après, avis affiché au joueur dans son profil ; historique des corrections dans la fiche joueur (migration `1030`).
- **Fiche joueur conforme au RGPD** : e-mail masqué (affichage complet réservé aux administrateurs, motivé et journalisé), dernière activité, succès ; jamais de mot de passe ni de position.
- **Écran Confidentialité** (données, accès, durées, droits) et **suppression de compte** par le joueur (droit à l'effacement ; salons transmis à un autre membre ; migration `1040`).

### Tests
- 107 tests automatisés (dont 4 nouveaux : corrections, succès, RGPD, suppression de compte).
- **Test de bout en bout réel** du code e-mail sur le serveur de production : inscription, e-mail reçu, mauvais code refusé, bon code accepté, adresse confirmée, compte supprimé.

## [0.4.0] — 2026-11-20

Grande mise à jour fonctionnelle : administration, nouveaux modes, capture QR, objectifs, sécurité, communication d'équipe, distribution hors store, préparation iOS. Build Android : 400. Nom affiché : **Manhunt**.

### Ajouté — administration (migration `1000`)
- Rôles serveur : propriétaire > administrateur > modérateur > joueur (l'hôte reste propre à chaque salon). Seul le propriétaire attribue les rôles.
- Tableau de bord intégré (Réglages → Administration) : activité (inscrits, connectés, parties, salons), état du backend (base, temps réel, tâches pg_cron), erreurs remontées par l'application, quotas, nettoyage.
- Joueurs : recherche, fiche (statistiques, parties, sanctions), avertissement, suspension temporaire (modérateur : 72 h max), levée de sanction. Un compte suspendu ne peut plus créer ni rejoindre de salon.
- Parties et salons : participants, équipes, paramètres résumés (sans aucune coordonnée), pause / reprise / terminaison d'une partie bloquée (non comptée), fermeture de salon.
- Signalements : envoi par les joueurs (lobby, partie), notes internes, clôture avec décision, historique.
- Paramètres globaux : limite de joueurs (appliquée par le serveur), valeurs par défaut, activation des fonctionnalités, distance d'alerte de proximité, annonce sur l'accueil, publication de versions.
- Journal d'audit (auteur, rôle, action, cible, motif, résultat). Motif obligatoire pour toute action.
- Protection du gameplay : aucune fonction d'administration ne lit de position, ne capture, ne déplace ni ne modifie un résultat ; toute intervention en partie est annoncée à tous les joueurs.

### Ajouté — modes et gameplay (migration `1010`)
- **Royale** jouable : zone réduite par étapes (calcul serveur, déterministe), prochain cercle annoncé, avertissement avant réduction, élimination des Fugitifs restés dehors.
- **Mister X** jouable : un seul Fugitif, jamais diffusé en direct, position exacte révélée aux Chasseurs à intervalle régulier (et lui est prévenu).
- **Capture par QR code** : QR temporaire (45 s, usage unique) affiché par le Fugitif, scanné par le Chasseur ; code à 6 caractères si la caméra est indisponible ; contrôle de distance si les positions sont récentes. Méthode configurable : GPS, QR ou les deux.
- **Objectifs** : balises placées par l'hôte (points, victoire optionnelle si toutes prises) et point d'extraction ouvert en fin de partie (Fugitif mis à l'abri + bonus).
- **Zones** : zone polygonale, zones interdites (dans la zone = hors zone), validation serveur.
- **Spectateurs** : un joueur capturé suit la partie avec des positions différées (3 min par défaut) ; il perd l'accès au canal privé de son équipe (rotation des canaux à chaque capture) et ne peut plus communiquer.
- **GPS muet** : détecté côté serveur et signalé à tous (jamais traité comme de la triche), distinct d'une perte de réseau.

### Ajouté — sécurité, équipe, confort (migration `1020`)
- **SOS** : pause immédiate, alerte à tous, message, position exacte seulement si le joueur l'accepte, reprise impossible avant levée, rappel d'appeler le 112.
- **Heure de fin et point de rendez-vous** affichés en permanence.
- **Messages rapides** d'équipe (12 messages prédéfinis, anti-spam) et **repères sur la carte** (appui long, 3 min, invisibles de l'adversaire).
- **Batterie et état des coéquipiers** (API officielle du système, « inconnue » sinon), application en arrière-plan, GPS.
- **Notifications locales** en arrière-plan / écran éteint (catégories réglables, anti-répétition) et alertes de proximité (Chasseur proche, Fugitif détecté).
- **Configurations sauvegardées** : enregistrer, charger, renommer, dupliquer, supprimer.
- **Cartes hors ligne** : téléchargement du fond de carte d'une zone (zooms 12–16, 4 000 tuiles max), suppression.
- **Replay 24 h** : trajets reconstruits (arrondis à 10 m), lecture, chronologie, événements ; réservé aux participants.
- **Succès** (13, déblocage serveur) et **statistiques par mode**, séries de victoires.
- **Alerte de nouvelle version** (facultative / recommandée / importante, notes, lien) et préparation d'**EAS Update** (inactif tant que le projet n'est pas relié à expo.dev).

### Corrigé
- **Pause** : la durée du Leurre n'était pas prolongée et le délai « hors zone » continuait de courir pendant une pause.
- **Normalisation serveur** : des points sans longitude pouvaient être acceptés (test `jsonb_typeof` NULL) — trouvé par le test de parité.
- **iOS** : l'autorisation « Push » ajoutée par le module de notifications empêchait la signature avec un compte Apple gratuit ; retirée (notifications locales seulement).
- **Spectateurs** : un joueur capturé restait abonné au canal privé de son équipe.

### Modifié
- Nom affiché : Manhunt. APK livré sous le nom `Manhunt-vX.Y.Z.apk`.
- Nouveaux modules natifs : expo-camera, expo-notifications (local), expo-battery, expo-updates ; bibliothèque JavaScript qrcode-generator.
- `heartbeat` accepte l'état de l'appareil (compatible avec les versions 0.3.x).

### Tests
- 103 tests automatisés (30 unitaires, 73 PostgreSQL réel dont 15 nouveaux pour la v0.4.0), typage, lint, expo-doctor, bundle iOS.

## [0.3.1] — 2026-11-19

Correctif de livraison (build Android 301). **APK recommandé** : remplace v0.3.0 (conservée dans `releases/v0.3.0/`).

### Corrigé
- **Permissions Android superflues** retirées de l'APK : superposition d'écran (`SYSTEM_ALERT_WINDOW`), stockage externe (lecture/écriture), biométrie / empreinte, démarrage automatique, ainsi que les permissions Firebase Cloud Messaging et de badges de lanceurs (dépendance `expo-notifications` inutilisée supprimée). L'application ne demande plus que la localisation, le service de premier plan, Internet, les notifications et la vibration.
- **Contrôle de livraison** : le bundle JavaScript de l'APK n'était pas réellement lu (extraction `tar` impossible sous Windows) ; il est maintenant lu directement et vérifié (URL Supabase présente, jetons embarqués de rôle `anon` uniquement, aucune clé secrète du projet). Le rapport indique le bon certificat et le JDK réellement utilisé.

### Modifié
- Build natif : CMake 3.31.6 + ninja 1.12.1 (chemins longs Windows), compilation depuis une copie Git du commit livré (`C:/tqb`).

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
