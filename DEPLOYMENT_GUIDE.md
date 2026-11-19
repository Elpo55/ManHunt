# Guide de compilation et de distribution

L'application se compile avec **EAS Build** (cloud Expo, offre gratuite) ou localement. Le backend Supabase doit être configuré avant (SETUP_GUIDE.md).

Profils (`apps/mobile/eas.json`) :
| Profil | Usage | Android | iOS |
|--------|-------|---------|-----|
| `development` | développement avec rechargement instantané | APK | appareils enregistrés (compte Apple payant) |
| `preview` | version de test autonome à distribuer à vos amis | APK | ad hoc (compte Apple payant) |
| `production` | stores | AAB (Play Store) | App Store / TestFlight |

---

## 0. APK Android local — méthode de livraison de chaque version (recommandée pour tester)

Depuis la v0.3.0, chaque version finalisée est livrée sous forme d'APK **release** installable, compilé sur ce PC sans compte Expo :

```bash
npm run release:apk              # à la racine du dépôt
npm run release:apk -- --install # + installation sur un téléphone branché en débogage USB
```

Le script (`scripts/release-apk.mjs`) : typage, lint, tests → `expo prebuild --clean` → `gradlew assembleRelease` (arm64-v8a + armeabi-v7a) → contrôles (version et build lus dans l'APK avec `aapt`, signature `apksigner`, URL Supabase intégrée, aucune clé secrète) → `releases/vX.Y.Z/` :

```
releases/v0.3.0/
  application-v0.3.0.apk   (non versionné dans Git : trop lourd)
  CHANGELOG.md
  BUILD_REPORT.md          (version, build, SHA-256, signature, permissions, vérifications)
```

Il refuse d'écraser un APK déjà livré : augmentez d'abord la version. Prérequis : Android Studio (JDK intégré, `JAVA_HOME`), SDK Android (`ANDROID_HOME`) ; le NDK et CMake sont téléchargés automatiquement au premier build (~30 min la première fois, ~10 min ensuite). Sous Windows, le dépôt est monté temporairement sur un lecteur court (`subst`) pour contourner la limite de 260 caractères de la compilation C++.

### Signature de l'APK
- **Par défaut : clé de débogage** publique du modèle React Native. Suffisant pour tester entre amis ; **non publiable** (Google Play la refuse) et n'importe qui la possède. Le rapport de build l'indique.
- **Clé personnelle** (à créer **vous-même**, une seule fois, et à sauvegarder : sans elle, impossible de publier une mise à jour) :
  ```powershell
  & "$env:JAVA_HOMEin\keytool.exe" -genkeypair -v -storetype PKCS12 `
    -keystore "$env:USERPROFILE\cles	raque-release.jks" -alias traque `
    -keyalg RSA -keysize 4096 -validity 10000
  ```
  Conservez le fichier **hors du dépôt** (et une copie sauvegardée) et les mots de passe dans un gestionnaire. Puis, avant `npm run release:apk` :
  ```powershell
  $env:TRAQUE_KEYSTORE = "$env:USERPROFILE\cles	raque-release.jks"
  $env:TRAQUE_KEY_ALIAS = "traque"
  $env:TRAQUE_KEYSTORE_PASSWORD = "…"; $env:TRAQUE_KEY_PASSWORD = "…"
  ```
  ⚠️ Passer de la clé de débogage à la clé personnelle oblige à **désinstaller** l'ancienne version une fois (Android refuse une mise à jour signée par une autre clé).

### Installer l'APK sur le téléphone
1. Copier le fichier (câble USB, Drive, e-mail) ou `adb install -r releases/vX.Y.Z/application-vX.Y.Z.apk`.
2. Ouvrir le fichier → autoriser « Installer des applications inconnues » pour l'application utilisée.
3. Ouvrir **Projet Traque** → Réglages : la ligne « Version X.Y.Z (build N) » doit correspondre au dossier livré.

## 1. Development build (développement)

```bash
cd apps/mobile
npx eas-cli build --profile development --platform android
```
À la fin, EAS affiche un lien et un QR code : ouvrez-le sur le téléphone Android pour installer l'APK. Puis, sur l'ordinateur :
```bash
npm run start          # depuis apps/mobile ; ou « npm run mobile » à la racine
```
Ouvrez l'application installée : elle se connecte au serveur de développement (même Wi-Fi, ou `npx expo start --dev-client --tunnel`).

Alternative locale Android (sans EAS) : Android Studio + SDK + NDK installés, téléphone en débogage USB, puis `npx expo run:android`. (Ce PC possède déjà le SDK Android ; le NDK et un émulateur restent à installer — plusieurs Go.)

## 2. Version de test pour vos amis (preview)

```bash
npx eas-cli build --profile preview --platform android
```
Partagez le lien de téléchargement de l'APK (page du build sur expo.dev → **Install**). Chaque ami autorise l'installation depuis son navigateur.

iOS (compte Apple payant) : enregistrez chaque iPhone (`npx eas-cli device:create`), puis `npx eas-cli build --profile preview --platform ios` et partagez le lien.

## 3. Mettre à jour l'application

- **Code JavaScript seulement** (écrans, logique) : recompiler le profil voulu, ou mettre en place EAS Update plus tard (`npx expo install expo-updates`, non configuré à ce stade).
- **Changement natif** (nouvelle permission, nouveau module, `app.config.ts`) : nouveau build obligatoire.
- **Base de données** : nouvelle migration dans `supabase/migrations/` puis `npx supabase db push`, **avant** de distribuer l'application qui en dépend.
- Versions : **source unique `apps/mobile/package.json`** (versionnement sémantique). Le numéro de build Android (`versionCode`) et iOS (`buildNumber`) en est dérivé : `MAJEUR*10000 + MINEUR*100 + CORRECTIF` (0.3.0 → 300). `eas.json` utilise `appVersionSource: local` : un build EAS porte le même numéro qu'un APK local.

## 4. Revenir en arrière

- **Application** : réinstallez l'APK d'une version précédente depuis `releases/` (désinstallation préalable nécessaire si son numéro de build est inférieur), ou depuis l'historique des builds sur expo.dev (Android) ; sur iOS, réinstallez un build précédent (ad hoc) ou une ancienne version TestFlight.
- **Code** : `git revert <commit>` puis recompilation.
- **Base** : écrire une migration corrective (les migrations ne s'annulent pas automatiquement). Sauvegarde ponctuelle : `npx supabase db dump -f sauvegarde.sql`.
- **Version web historique** : `git checkout v0.1.0-web`.

## 5. Publication sur les stores (facultatif)

### Google Play (25 $ une fois)
1. https://play.google.com/console → création du compte développeur (vérification d'identité).
2. `npx eas-cli build --profile production --platform android` (AAB).
3. Console : créer l'application, fiche, **Contenu de l'application → Règles de confidentialité** (URL d'une politique décrivant le partage de position), **Déclaration des autorisations de localisation en arrière-plan** (justification + vidéo montrant la fonctionnalité et la notification), **Sécurité des données** (localisation précise collectée, partagée avec d'autres utilisateurs, chiffrée en transit, supprimable).
4. `npx eas-cli submit -p android` ou envoi manuel ; piste **Test interne** d'abord.

### App Store (Apple Developer Program, 99 $/an)
1. `npx eas-cli build --profile production --platform ios`, puis `npx eas-cli submit -p ios` (TestFlight).
2. App Store Connect : fiche, **Confidentialité de l'app** (localisation précise, liée à l'utilisateur, non utilisée pour le suivi publicitaire), politique de confidentialité, justification de la localisation en arrière-plan pour la revue.
3. Les textes des autorisations sont déjà rédigés dans `app.config.ts`.

Une **politique de confidentialité** publique est exigée par les deux stores : elle peut reprendre docs/SECURITY.md (sections « Données de localisation » et « Rétention »).

## 6. iOS depuis macOS (non réalisable sur ce PC Windows)

Le code est commun ; ce qui diffère : invites de localisation (« Lorsque l'app est active » puis « Toujours » proposé plus tard par iOS), indicateur bleu de localisation en arrière-plan, mises à jour GPS parfois espacées en arrière-plan, pas de bouton retour matériel (le geste retour est désactivé sur l'écran de jeu).

Sur un Mac (Xcode 26+, CocoaPods) :
```bash
npm install
cd apps/mobile
npx expo prebuild --platform ios --clean
npx expo run:ios --device          # identifiant Apple gratuit : installation valable 7 jours
# ou, avec l'Apple Developer Program : npx eas-cli build --profile preview --platform ios
```
À vérifier sur iPhone : textes des autorisations (`app.config.ts` → `infoPlist`), « Position exacte » activée, mode arrière-plan `location` présent (ajouté par le plugin expo-location), carte MapLibre (tuiles et attribution), notification de fin de partie.
