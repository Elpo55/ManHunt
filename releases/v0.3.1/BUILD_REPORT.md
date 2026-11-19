# Rapport de build — v0.3.1 (build 301)

| | |
|---|---|
| Date | 2026-11-19 18:49 UTC |
| Fichier | `releases/v0.3.1/application-v0.3.1.apk` (65.5 Mo) |
| SHA-256 | `47c8dc8150f34047b9a4ec28df5c5e0f6144287bd23b651c31983bcfa71c7191` |
| Type | **APK release** (bundle JavaScript intégré, sans serveur de développement) — ⚠️ contient le client de développement |
| Identifiant | `com.elpo55.syceus` |
| versionName / versionCode | 0.3.1 / 301 ✅ conformes à apps/mobile/package.json |
| Android | minSdk 24 · targetSdk 36 |
| Architectures | arm64-v8a armeabi-v7a |
| Signature | ⚠️ **clé de DÉBOGAGE** (modèle React Native) — test uniquement, non publiable |
| Certificat | CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US · SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` · schémas v2 |
| Commit | `e8d34a5` |
| Outils | Expo SDK 58.0.26 · React Native 0.88.1 · openjdk version "21.0.10" 2026-01-20 · build-tools 37.0.0 · CMake 3.31.6 |
| Durée | 6.6 min |

## Vérifications
- ✅ Typage
- ✅ Lint
- ✅ Tests automatisés
- ✅ Compilation Gradle `assembleRelease` terminée sans erreur
- ✅ APK présent, lisible par `aapt`, version et identifiant conformes
- ✅ Signature vérifiée par `apksigner verify`
- ✅ Configuration Supabase publique intégrée au bundle (URL du projet présente)
- ✅ Aucun secret dans le bundle : jetons embarqués tous de rôle `anon` ; aucune des 2 clés secrètes du projet présente
- Installation sur téléphone : non demandée (`--install`)

## Permissions déclarées
`ACCESS_BACKGROUND_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS`, `VIBRATE`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `com.elpo55.syceus.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE`

## Installation
1. Copier `application-v0.3.1.apk` sur le téléphone (câble, Drive, e-mail…), ou `adb install -r releases/v0.3.1/application-v0.3.1.apk`.
2. Ouvrir le fichier, autoriser « Installer des applications inconnues » pour l'application utilisée.
3. Une version précédente **signée avec la même clé** est mise à jour en conservant la session. Si Android refuse (« conflit de signature »), désinstaller l'ancienne version d'abord.

## Note de vérification manuelle (ajoutée après génération)
La mention « ⚠️ contient le client de développement » ci-dessus est une **fausse alerte** du contrôle automatique de cette version : vérifié avec `aapt dump xmltree` et `aapt list`, le manifeste ne déclare que `MainActivity` (aucune `DevLauncherActivity` / `DevMenuActivity`) et l'APK ne contient aucun fichier `expo-dev-launcher` ; seul le nom de module `EXDevLauncher` (test d'existence par Expo) figure dans le bundle. C'est bien un APK release autonome. Le contrôle a été corrigé pour les versions suivantes (lecture du manifeste).
