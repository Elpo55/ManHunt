# Rapport de build — v0.5.0 (build 500)

| | |
|---|---|
| Date | 2026-11-20 17:19 UTC |
| Fichier | `releases/v0.5.0/Manhunt-v0.5.0.apk` (76.1 Mo) |
| SHA-256 | `9ce00dba91477653054b64cc8a2516a5adcf1ebe34944f0c061adaf948ea5dca` |
| Type | **APK release** (bundle JavaScript intégré, sans serveur de développement) |
| Identifiant | `com.elpo55.syceus` |
| versionName / versionCode | 0.5.0 / 500 ✅ conformes à apps/mobile/package.json |
| Android | minSdk 24 · targetSdk 36 |
| Architectures | arm64-v8a armeabi-v7a |
| Signature | ⚠️ **clé de DÉBOGAGE** (modèle React Native) — test uniquement, non publiable |
| Certificat | CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US · SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` · schémas v2 |
| Commit | `2f055a6` |
| Outils | Expo SDK 58.0.26 · React Native 0.88.1 · openjdk version "21.0.10" 2026-01-20 · build-tools 37.0.0 · CMake 3.31.6 |
| Durée | 5.1 min |

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
`ACCESS_BACKGROUND_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS`, `VIBRATE`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `WAKE_LOCK`, `com.elpo55.syceus.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, `com.sec.android.provider.badge.permission.READ`, `com.sec.android.provider.badge.permission.WRITE`, `com.htc.launcher.permission.READ_SETTINGS`, `com.htc.launcher.permission.UPDATE_SHORTCUT`, `com.sonyericsson.home.permission.BROADCAST_BADGE`, `com.sonymobile.home.permission.PROVIDER_INSERT_BADGE`, `com.anddoes.launcher.permission.UPDATE_COUNT`, `com.majeur.launcher.permission.UPDATE_BADGE`, `com.huawei.android.launcher.permission.CHANGE_BADGE`, `com.huawei.android.launcher.permission.READ_SETTINGS`, `com.huawei.android.launcher.permission.WRITE_SETTINGS`, `READ_APP_BADGE`, `com.oppo.launcher.permission.READ_SETTINGS`, `com.oppo.launcher.permission.WRITE_SETTINGS`, `me.everything.badger.permission.BADGE_COUNT_READ`, `me.everything.badger.permission.BADGE_COUNT_WRITE`

## Installation
1. Copier `Manhunt-v0.5.0.apk` sur le téléphone (câble, Drive, e-mail…), ou `adb install -r releases/v0.5.0/Manhunt-v0.5.0.apk`.
2. Ouvrir le fichier, autoriser « Installer des applications inconnues » pour l'application utilisée.
3. Une version précédente **signée avec la même clé** est mise à jour en conservant la session. Si Android refuse (« conflit de signature »), désinstaller l'ancienne version d'abord.
