# Ce qu'il vous reste à faire

Légende : `[ ]` à faire par vous · `[x]` fait par Claude (vérifié) · `[ ] (à vérifier)` à contrôler · `[!]` bloqué (compte, paiement ou appareil requis).

État au 20 novembre 2026 — **version 0.4.0 (build 400)**.

---

## Déjà fait

- [x] Audit, sauvegardes (`v0.1.0-web`, branche `archive/web-real-world-map`), plan de migration (docs/MIGRATION_MOBILE_GPS.md).
- [x] Monorepo : `packages/shared` (logique testée) + `apps/mobile` (Expo SDK 58, 19 écrans). Migrations serveur 0100 → 1020, **toutes appliquées au projet Supabase**.
- [x] **Supabase configuré** (projet `ibyntjdoongvrvrieicn`, eu-west-1) : 9 migrations appliquées, 13 tables avec RLS, invité ON, confirmation e-mail OFF, limite invités 100/h/IP, Realtime privé + Presence, pg_cron (`pt-tick`, `pt-cleanup`).
- [x] `apps/mobile/.env` rempli (URL, clé publique *anon*, `APP_BUNDLE_ID=com.elpo55.syceus`).
- [x] v0.3.0 : audit complet et corrections (voir CHANGELOG.md), 85 tests automatisés **exécutés et réussis**, typage et lint propres.
- [x] v0.3.1 : permissions Android superflues retirées, contrôles de livraison fiabilisés.
- [x] v0.4.0 : administration (votre compte Elpo55 = **propriétaire**), Royale, Mister X, QR, objectifs, zones, spectateurs, SOS, équipe, notifications locales, configurations, cartes hors ligne, replay, succès ; 103 tests réussis ; guide iOS `GUIDE_INSTALLATION_IOS_POUR_TESTEUR.txt`.
- [x] **APK Android release compilés sur ce PC** : `releases/v0.4.0/Manhunt-v0.4.0.apk` (**à installer**) ; `releases/v0.3.0/` et `v0.3.1/` conservés. Signés avec la clé de **débogage** (test uniquement). Contrôles statiques réussis ; **installation non testée** (aucun téléphone ni émulateur disponible).

**Jamais réalisé à ce jour** : installation sur un téléphone, test GPS réel, partie à plusieurs appareils, build iOS. Ces étapes exigent vos appareils.

## 0. Priorité : tester l'APK v0.4.0
- [ ] Installer `releases/v0.4.0/Manhunt-v0.4.0.apk` (la v0.3.1 est mise à jour en conservant la session : même clé de débogage).
- [ ] Dérouler TESTING_GUIDE §1 bis puis la **checklist v0.4.0 (§1 ter, 22 points)** avec un second téléphone.
- [ ] Ouvrir Réglages > Administration : vérifier le tableau de bord (vous êtes propriétaire).
- [ ] M'envoyer les KO (modèle, version d'Android, capture d'écran si possible).
- [x] Compte administrateur (fait : propriétaire).

## 0 bis. Pour votre ami iPhone
- [ ] L'inviter sur GitHub : dépôt ManHunt > Settings > Collaborators > Add people (son nom d'utilisateur GitHub).
- [ ] Lui envoyer **en privé** l'adresse du serveur (`https://ibyntjdoongvrvrieicn.supabase.co`) et la **clé publique** (`EXPO_PUBLIC_SUPABASE_ANON_KEY` de votre `apps/mobile/.env`) — jamais la clé `service_role` ni une clé secrète.
- [ ] Lui donner `GUIDE_INSTALLATION_IOS_POUR_TESTEUR.txt` (aussi dans le dépôt). Il lui faut un Mac récent (Xcode 26+), son iPhone et son identifiant Apple gratuit.

## 0 ter. Distribution (facultatif)
- [ ] Héberger l'APK à une adresse https pour vos amis (Drive, etc.), puis Administration > Réglages > « Publier une version » avec ce lien : les téléphones plus anciens verront l'alerte de mise à jour (DEPLOYMENT_GUIDE §7).
- [ ] EAS Update (correctifs sans réinstaller) : compte Expo gratuit + `npx eas-cli init` puis me le dire (DEPLOYMENT_GUIDE §6).

## 1. Comptes externes

### 1.1 [x] Supabase (fait)
- **Objectif / utilité** : héberger le serveur du jeu (base, authentification, temps réel). Indispensable.
- **Actions** : SETUP_GUIDE §1.1 (plan Free, région Europe, mot de passe généré et conservé).
- **À récupérer** : URL du projet, clé publique (*anon* ou *publishable*), *Project ref*, mot de passe de la base.
- **Vérification** : le tableau de bord du projet s'ouvre.

### 1.2 [ ] Expo (expo.dev) — facultatif depuis la v0.3.0 (APK compilés localement)
- **Objectif** : compiler les applications Android/iOS dans le cloud (EAS Build, offre gratuite).
- **Actions** : https://expo.dev/signup ; puis `cd apps/mobile && npx eas-cli@latest login`.
- **Vérification** : `npx eas-cli whoami` affiche votre identifiant.

### 1.3 [x] GitHub (fait)
- Dépôt **privé** https://github.com/Elpo55/ManHunt : branches `main` et `archive/web-real-world-map`, étiquette `v0.1.0-web`.
- Vérifié : aucun `.env`, keystore ni APK dans le dépôt ni dans l'historique (les APK restent dans `releases/` sur ce PC).
- Récupérer le projet ailleurs : `gh repo clone Elpo55/ManHunt` puis `npm install` et recréer `apps/mobile/.env` (valeurs dans `apps/mobile/.env.example` + tableau de bord Supabase).

### 1.4 [!] Apple Developer Program — **décision à prendre (99 $/an)**
- **Objectif** : installer l'application sur des iPhone (hors App Store) et publier sur l'App Store.
- **Pourquoi** : Apple n'autorise pas l'installation d'une application compilée dans le cloud sans ce programme. Alternative gratuite : un Mac + Xcode (installation valable 7 jours).
- **Actions si oui** : https://developer.apple.com/programs → *Enroll* (24–48 h de validation).
- **Vérification** : accès à https://developer.apple.com/account.
- Tant que ce n'est pas décidé, **testez sur Android** (gratuit).

### 1.5 [ ] Google Play Console (facultatif, 25 $ une fois)
- Seulement pour publier sur le Play Store. Les APK de test se partagent gratuitement sans ce compte.

### 1.6 [ ] MapTiler (facultatif)
- **Objectif** : fournisseur de tuiles avec engagement de service si OpenFreeMap (gratuit, sans garantie) devient lent ou indisponible.
- **Actions** : SETUP_GUIDE §2. **Vérification** : carte affichée avec `EXPO_PUBLIC_MAP_PROVIDER=maptiler`.

---

## 2. Configuration Supabase

### 2.1 [x] Appliquer les migrations (fait, 0100 → 0900)
- **Objectif** : créer tables, moteur GPS et sécurité.
- **Actions** (racine du dépôt) : `npx supabase login` → `npx supabase link --project-ref xxxx` → `npx supabase db push`.
- **Résultat attendu** : « Finished supabase db push ».
- **Vérification** : Table Editor = 13 tables « RLS enabled », `abilities` = 8 lignes ; schéma `private` contient `player_positions`.

### 2.2 [x] Authentification (fait)
- **Actions** : SETUP_GUIDE §1.4 — **Allow anonymous sign-ins : ON** ; **Confirm email : OFF** (recommandé).
- **Vérification** : « Jouer en invité » fonctionne dans l'application.

### 2.3 [x] Realtime privé (fait)
- **Actions** : SETUP_GUIDE §1.5 — désactiver **Allow public access**.
- **Vérification** : le lobby affiche les joueurs en ligne (point vert) et se met à jour instantanément.

### 2.4 [x] pg_cron (fait)
- **Actions** : SETUP_GUIDE §1.6.
- **Vérification** : `select jobname from cron.job;` → `pt-tick`, `pt-cleanup`.

### 2.5 [ ] Compte administrateur
- **Actions** : SETUP_GUIDE §1.7 (après votre première connexion).
- **Vérification** : Réglages → « Administration : quotas ».

---

## 3. Configuration de l'application (locale)

### 3.1 [ ] Dépendances
`npm install` à la racine (déjà fait sur ce PC ; à refaire ailleurs). **Vérification** : `npm test` → 78 tests réussis.

### 3.2 [x] Fichier `apps/mobile/.env` (fait)
- **Actions** : `cp apps/mobile/.env.example apps/mobile/.env` puis renseigner `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `APP_BUNDLE_ID` (ex. `com.prenomnom.traque`, **définitif après publication**).
- **Vérification** : `git status` ne montre pas ce fichier.

### 3.3 [ ] Projet EAS et variables
- **Actions** (dans `apps/mobile`) : `npx eas-cli init` ; si demandé, définir `EAS_PROJECT_ID` ; ajouter les variables sur expo.dev (SETUP_GUIDE §4.3) pour *development, preview, production*.
- **Vérification** : expo.dev → projet → *Environment variables* liste les 4 variables.

---

## 4. Android

### 4.1 [ ] Build de développement
- **Actions** : `npx eas-cli build --profile development --platform android` ; accepter la création du *keystore* (signature conservée par EAS).
- **Résultat** : lien/QR d'installation de l'APK (10–30 min, file gratuite).
- **Vérification** : l'application « Projet Traque » (icône réticule) s'ouvre sur le téléphone.

### 4.2 [ ] Clé de signature personnelle (avant toute publication)
- **Pour les APK locaux** : la créer vous-même avec `keytool` (DEPLOYMENT_GUIDE §0 « Signature »), la stocker hors du dépôt et la sauvegarder ; je l'utiliserai via les variables `TRAQUE_KEYSTORE…`.
- **Pour les builds EAS** :
- **Pourquoi** : sans elle, impossible de mettre à jour l'application publiée.
- **Actions** : `npx eas-cli credentials` → Android → *Download keystore* → stocker en lieu sûr (hors dépôt).

### 4.3 [ ] Réglages du téléphone
- Autoriser l'installation depuis le navigateur ; dans l'application, localisation « Toujours autoriser » + **Position exacte** ; **batterie non restreinte** pour l'application.
- **Vérification** : écran Localisation de l'application : toutes les lignes vertes.

### 4.4 [ ] Version à partager (preview)
- `npx eas-cli build --profile preview --platform android` → partager le lien d'installation à vos amis Android.

---

## 5. iOS — [!] bloqué par la décision 1.4

### 5.1 [!] Build et installation
- **Avec le programme Apple** : `npx eas-cli device:create` (chaque iPhone de test ouvre le lien), puis `npx eas-cli build --profile development --platform ios` (EAS crée certificats et profils), installer via le lien.
- **Avec un Mac (gratuit)** : Xcode installé, iPhone branché, `cd apps/mobile && npx expo run:ios --device`.
- **Sur l'iPhone** : Réglages → Confidentialité et sécurité → **Mode développeur** activé ; localisation « Toujours » + « Position exacte ».
- **Vérification** : l'application s'ouvre et l'écran Localisation est tout vert.

---

## 6. Tests réels (indispensables)

### 6.1 [ ] Test de charge réseau
`npm run test:load` (après 2.x et 3.2). **Vérification** : « ✓ Aucun problème bloquant détecté. » — envoyez-moi la sortie sinon.

### 6.2 [ ] Un téléphone
TESTING_GUIDE §3 (autorisations, zone, consentement, badge GPS).

### 6.3 [ ] Déconnexions et arrière-plan
TESTING_GUIDE §4 sur **au moins un Android et (si possible) un iPhone** — c'est le point le plus dépendant des appareils.

### 6.4 [ ] Radar et captures
TESTING_GUIDE §5 avec deux téléphones.

### 6.5 [ ] Partie complète
TESTING_GUIDE §7 dans un parc, en remplissant la fiche de relevé. **Envoyez-moi les lignes KO** (modèle de téléphone, version d'OS).

---

## 7. Publication (facultatif, après les tests)

### 7.1 [ ] Politique de confidentialité publique
Exigée par les stores ; base : docs/SECURITY.md. À héberger sur une page web publique (ex. GitHub Pages).

### 7.2 [ ] Google Play
DEPLOYMENT_GUIDE §5 : compte (25 $), build `production`, déclaration de **localisation en arrière-plan** avec vidéo, formulaire *Sécurité des données*, test interne.

### 7.3 [!] App Store
DEPLOYMENT_GUIDE §5 : programme Apple, TestFlight, *Confidentialité de l'app*, justification de l'arrière-plan.

---

## 8. Administration et règles de fonctionnement

- [ ] Comprendre les rôles : joueur / hôte (règles, équipes, lancement, pause, fin, exclusion) / administrateur (quotas, nettoyage — aucun pouvoir en partie).
- [ ] Comprendre la confidentialité : partage seulement en partie, après accord ; positions arrondies ; effacement 24 h après ; bouton Arrêt.
- [ ] Limites gratuites (docs/QUOTAS.md) : ~20–30 parties de 30 min à 20 joueurs par mois ; projet Supabase mis en pause après ~7 jours sans activité (**Restore project** avant une soirée de jeu).
- [ ] Choisir un nom définitif quand vous le souhaitez (`EXPO_PUBLIC_APP_NAME`, puis recompiler).

## Si vous voulez que je continue

Envoyez : la sortie de `npx supabase db push`, celle de `npm run test:load`, la fiche de relevé de la première partie, et votre décision sur le compte Apple. **Ne m'envoyez jamais** la clé `service_role`, une *secret key*, le mot de passe de la base ni le *keystore*.
