# Quotas et coûts (v0.2 — mobile)

> Les offres évoluent : vérifiez les pages officielles avant de vous y fier. Chiffres relevés en novembre 2026.

## Supabase (Free)

| Ressource | Limite | Usage du jeu |
|-----------|--------|--------------|
| Connexions Realtime simultanées | 200 ([doc](https://supabase.com/docs/guides/realtime/limits)) | 1 par joueur |
| Messages Realtime / s | 100 ([doc](https://supabase.com/docs/guides/realtime/limits)) ; au-delà, déconnexions | **~32/s** en moyenne mesurés en simulation à 20 joueurs (envoi toutes les 5 s, adversaires toutes les 15 s), jusqu’à ~50/s quand les 20 joueurs sont actifs |
| Messages Realtime / mois | ~2 M (sources tierces, à vérifier sur [supabase.com/pricing](https://supabase.com/pricing)) | ~60 000 à 90 000 par partie de 30 min à 20 joueurs → environ 20 à 30 parties/mois |
| Base de données | ~500 Mo (à vérifier) | positions brutes effacées après 24 h ; ~1 Mo d'événements par partie |
| Inscriptions anonymes | 30 / heure / IP (réglable) | 1 par nouveau téléphone |
| Mise en pause | projet inactif ~7 jours | relancer depuis le tableau de bord |

Réduire la consommation : intervalle d'envoi 8–10 s, actualisation adversaires 30 s, mode « par impulsions ».

## Cartographie

| Service | Coût | Remarques |
|---------|------|-----------|
| OpenFreeMap (défaut) | gratuit, sans compte | fourni « tel quel », sans garantie ([CGU](https://openfreemap.org/tos/)) |
| MapTiler (option) | offre gratuite limitée, clé requise | à vérifier sur maptiler.com/cloud/pricing |
| Nominatim (recherche de lieu) | gratuit | 1 requête/s max, application identifiée ([politique](https://operations.osmfoundation.org/policies/nominatim/)) ; l'application ne cherche qu'à la validation |
| tile.openstreetmap.org | — | **non utilisé** (politique OSMF) |

## Expo / EAS

| Élément | Coût |
|---------|------|
| Compte Expo, EAS Build Free | gratuit ; environ 15 builds Android + 15 iOS / mois, file basse priorité (à vérifier sur expo.dev/pricing) |
| Builds locaux (`npx expo run:android`) | gratuits, nécessitent Android Studio/NDK (plusieurs Go) |

## Stores et signature

| Élément | Coût | Nécessaire pour |
|---------|------|-----------------|
| Android : APK interne (EAS `preview`/`development`) | gratuit | installer sur vos téléphones et ceux de vos amis |
| Google Play Console | 25 $ une fois | publication sur le Play Store (déclaration « localisation en arrière-plan » + vidéo exigées) |
| **Apple Developer Program** | **99 $ / an** | installer sur iPhone via EAS (ad hoc / TestFlight) et publier sur l'App Store |
| Alternative iOS sans abonnement | gratuit | un **Mac** + Xcode + identifiant Apple gratuit : installation locale valable 7 jours |

**Aucune dépense n'a été engagée.** Les options payantes sont signalées dans REMAINING_TASKS.md comme décisions à prendre par vous.
