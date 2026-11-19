# Rapport de build — v0.3.0 (build 300)

| | |
|---|---|
| Date | 2026-11-19 18:39 UTC |
| Fichier | `releases/v0.3.0/application-v0.3.0.apk` (65.8 Mo) |
| SHA-256 | `7c34fd63ca638b5bca1896a2d4147e63188d6b4db6ba3726e6f50e887216eef7` |
| Type | **APK release** (bundle JavaScript intégré, sans serveur de développement) |
| Identifiant | `com.elpo55.syceus` |
| versionName / versionCode | 0.3.0 / 300 ✅ conformes à apps/mobile/package.json |
| Android | minSdk 24 · targetSdk 36 |
| Architectures | arm64-v8a armeabi-v7a |
| Signature | ⚠️ **clé de DÉBOGAGE** (modèle React Native) — test uniquement, non publiable |
| Certificat | ? · SHA-256 `?` · schémas v2 |
| Commit | `9f387a1` |
| Outils | Expo SDK 58.0.26 · React Native 0.88.1 · java version "1.8.0_461" · build-tools 37.0.0 · CMake 3.31.6 |
| Durée | 5.5 min |

## Vérifications
- ✅ Typage
- ✅ Lint
- ✅ Tests automatisés
- ✅ Compilation Gradle `assembleRelease` terminée sans erreur
- ✅ APK présent, lisible par `aapt`, version et identifiant conformes
- ✅ Signature vérifiée par `apksigner verify`
- ⚠️ Configuration Supabase publique intégrée au bundle (non vérifiable : extraction impossible)
- ✅ Aucune clé secrète Supabase (`sb_secret_`, `service_role`) dans le bundle
- Installation sur téléphone : non demandée (`--install`)

## Permissions déclarées
`ACCESS_BACKGROUND_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS`, `READ_EXTERNAL_STORAGE`, `RECEIVE_BOOT_COMPLETED`, `SYSTEM_ALERT_WINDOW`, `VIBRATE`, `WRITE_EXTERNAL_STORAGE`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE`, `com.elpo55.syceus.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE`, `com.sec.android.provider.badge.permission.READ`, `com.sec.android.provider.badge.permission.WRITE`, `com.htc.launcher.permission.READ_SETTINGS`, `com.htc.launcher.permission.UPDATE_SHORTCUT`, `com.sonyericsson.home.permission.BROADCAST_BADGE`, `com.sonymobile.home.permission.PROVIDER_INSERT_BADGE`, `com.anddoes.launcher.permission.UPDATE_COUNT`, `com.majeur.launcher.permission.UPDATE_BADGE`, `com.huawei.android.launcher.permission.CHANGE_BADGE`, `com.huawei.android.launcher.permission.READ_SETTINGS`, `com.huawei.android.launcher.permission.WRITE_SETTINGS`, `READ_APP_BADGE`, `com.oppo.launcher.permission.READ_SETTINGS`, `com.oppo.launcher.permission.WRITE_SETTINGS`, `me.everything.badger.permission.BADGE_COUNT_READ`, `me.everything.badger.permission.BADGE_COUNT_WRITE`

## Installation
1. Copier `application-v0.3.0.apk` sur le téléphone (câble, Drive, e-mail…), ou `adb install -r releases/v0.3.0/application-v0.3.0.apk`.
2. Ouvrir le fichier, autoriser « Installer des applications inconnues » pour l'application utilisée.
3. Une version précédente **signée avec la même clé** est mise à jour en conservant la session. Si Android refuse (« conflit de signature »), désinstaller l'ancienne version d'abord.
