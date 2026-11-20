# Manhunt

Application mobile **Android et iOS** de chasse géolocalisée entre amis : les **Chasseurs** poursuivent les **Fugitifs** dans le monde réel, sur une vraie carte OpenStreetMap, à partir de la position GPS de chaque joueur — partagée **uniquement pendant une partie, avec consentement explicite**, et arrondie avant d'être montrée aux autres.

> Nom affiché réglable avec `EXPO_PUBLIC_APP_NAME` (défaut : « Manhunt »). Version courante : **0.4.0** (build 400).

## Fonctionnalités

- **Comptes** : invité (sans e-mail) ou e-mail ; liaison invité → e-mail ; session dans le trousseau sécurisé du téléphone.
- **Salons privés** : code à 6 caractères, partage d'invitation (lien `traque://join?code=…`), présence en ligne, équipes (libres ou imposées), répartition aléatoire, exclusion/bannissement, transfert d'hôte.
- **Zone de jeu réelle** : l'hôte cherche un lieu (OpenStreetMap) ou déplace la carte, règle le rayon (150 m – 3 km).
- **Sécurité intégrée** : consignes affichées et **acceptation obligatoire** par chaque joueur (le serveur refuse de lancer sinon), bouton **Arrêt** toujours visible (fin immédiate du partage + effacement des positions), pause / fin immédiates par l'hôte, zone délimitée, aucune capture par contact physique.
- **GPS réel** : autorisations expliquées, état du partage affiché en permanence (précision, signal perdu, hors ligne, arrière-plan), envoi périodique optimisé batterie, suivi en arrière-plan quand l'OS l'autorise (service de premier plan Android, mode « Toujours » iOS), repli au premier plan, arrêt automatique en fin de partie.
- **Visibilité** : coéquipiers à ~10 m ; adversaires **approximatifs** (30 m par défaut, jamais plus précis que le GPS), actualisés régulièrement ou par impulsions ; indicateur d'ancienneté, positions obsolètes grisées, joueurs déconnectés jamais animés.
- **Radar serveur** : direction + distance, secteur ou zone ; automatique ou manuel ; brouillage ; alerte côté adverse.
- **Captures** : par proximité GPS (15 m par défaut), positions fraîches et précises exigées, validées par le serveur.
- **Capacités** : Fantôme, Brouilleur, Leurre (Fugitifs) ; Scan, Traqueur, Sonar (Chasseurs).
- **Modes** : Classique, Infection, **Royale** (zone qui se réduit, calculée par le serveur) et **Mister X** (un Fugitif révélé à intervalle).
- **Capture par QR code** (temporaire, usage unique) ou code à 6 caractères, en plus de la capture GPS.
- **Objectifs** : balises à atteindre, point d'extraction ; **zones polygonales et interdites**.
- **Équipe** : messages rapides prédéfinis, repères sur la carte, batterie et état des coéquipiers.
- **Sécurité** : bouton **SOS** (pause immédiate, alerte, position seulement si acceptée, rappel du 112), heure de fin et point de rendez-vous, détection du **GPS muet**, spectateurs sans information exploitable.
- **Administration intégrée** : rôles (propriétaire, administrateur, modérateur), tableau de bord, sanctions, signalements, paramètres globaux, journal d'audit — sans aucun accès aux positions ni pouvoir sur les résultats.
- **Confort** : configurations sauvegardées, cartes hors ligne, replay 24 h, succès, statistiques par mode, notifications locales, alerte de nouvelle version.
- **Anti-triche** : vitesse implausible, horodatages incohérents, fréquence limitée, tout calculé côté serveur.
- **Après-partie** : résultats, classement, chronologie, replay, succès, statistiques, historique, classement privé.
- **iOS** : à compiler sur Mac avec un compte Apple gratuit — [GUIDE_INSTALLATION_IOS_POUR_TESTEUR.txt](GUIDE_INSTALLATION_IOS_POUR_TESTEUR.txt).

## Architecture

```
apps/mobile        Application Expo (React Native, TypeScript) — Android & iOS
packages/shared    Logique partagée pure et testée (règles, géo, état, contrôleur, carte)
supabase/          Migrations PostgreSQL (autorité du jeu, RLS, Realtime privé)
tests/             Vitest : unitaires + PostgreSQL réel (PGlite)
scripts/           Test de charge réel, génération d'icônes
docs/              Architecture, sécurité, quotas, audit de migration
```

Téléphone (GPS, carte MapLibre native) ⇄ Supabase : RPC validées par PostgreSQL + Realtime Broadcast privé par audience. Détails : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), [docs/QUOTAS.md](docs/QUOTAS.md), [docs/MIGRATION_MOBILE_GPS.md](docs/MIGRATION_MOBILE_GPS.md).

## Technologies

Expo SDK 58 · React Native 0.88 · TypeScript · Expo Router · expo-location / expo-task-manager · MapLibre React Native 11 · OpenStreetMap (OpenFreeMap par défaut, fournisseur interchangeable) · Supabase (Auth, PostgreSQL, Realtime) · Vitest · PGlite.

## Démarrage rapide (développement)

Prérequis : Node.js 20.9+, un projet Supabase configuré ([SETUP_GUIDE.md](SETUP_GUIDE.md)), un compte Expo.

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env   # renseigner l'URL et la clé publique Supabase
npm test                                       # 85 tests
npm run release:apk                            # APK Android release -> releases/vX.Y.Z/
cd apps/mobile
npx eas-cli build --profile development --platform android   # application de développement (une fois)
npm run start                                  # serveur de développement, scanner le QR code
```

Expo Go **ne suffit pas** (carte native et GPS en arrière-plan) : il faut une *development build* (voir [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)).

## Tests

```bash
npm test            # tout
npm run test:unit   # logique partagée
npm run test:db     # PostgreSQL : salons, GPS, sécurité, simulation 20 joueurs
npm run typecheck && npm run lint
npm run test:load   # test de charge RÉEL (projet Supabase requis)
```

Voir [TESTING_GUIDE.md](TESTING_GUIDE.md), dont la procédure de test terrain avec plusieurs téléphones.

## Versions et APK

Version courante : **0.4.0** (build 400). Chaque version finalisée est livrée en APK installable dans `releases/vX.Y.Z/` avec son changelog et son rapport de build (procédure : [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) §0, règles : [CLAUDE.md](CLAUDE.md)).

## Historique

La version web à positions virtuelles (v0.1) reste disponible : `git checkout v0.1.0-web`. Voir [CHANGELOG.md](CHANGELOG.md).

## Documents

[REMAINING_TASKS.md](REMAINING_TASKS.md) (vos actions, pas à pas) · [SETUP_GUIDE.md](SETUP_GUIDE.md) · [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) · [TESTING_GUIDE.md](TESTING_GUIDE.md) · [RAPPORT_FINAL.md](RAPPORT_FINAL.md)
