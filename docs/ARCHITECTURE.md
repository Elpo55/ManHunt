# Architecture (v0.2 — mobile GPS)

```
 Téléphone (Expo / React Native)                         Supabase
 ┌───────────────────────────────────┐   HTTPS RPC   ┌──────────────────────────────────┐
 │ expo-location (GPS)               │──────────────►│ PostgreSQL : fonctions security  │
 │  ├ premier plan : watchPosition   │  report_      │ definer = AUTORITÉ DU JEU        │
 │  └ arrière-plan : tâche + service │  position     │  - valide position, zone, vitesse│
 │ GameController (packages/shared)  │               │  - arrondit avant diffusion      │
 │  - séquenceur, horloge serveur    │◄──────────────│  - captures, radar, capacités    │
 │ MapLibre natif + tuiles OSM       │  WebSocket    │ Realtime Broadcast (canaux privés│
 └───────────────────────────────────┘  (Realtime)   │ autorisés par RLS)               │
                                                     │ private.player_positions (brut)  │
                                                     └──────────────────────────────────┘
```

## Décisions

| # | Décision | Justification |
|---|----------|---------------|
| M1 | **Expo SDK 58 + React Native**, *development builds* | Une base TypeScript pour Android et iOS, réutilisation de la logique existante, modules natifs de localisation/tâches/stockage sécurisé, compilation iOS sans Mac via EAS. Expo Go exclu (MapLibre natif, arrière-plan). |
| M2 | **MapLibre React Native 11** + tuiles **OpenStreetMap** vectorielles | Rendu natif fluide, même spécification de style que le web : le style sombre « Nocturne » est partagé. |
| M3 | **Fournisseur de tuiles interchangeable** (`EXPO_PUBLIC_MAP_PROVIDER`) | OpenFreeMap (défaut, sans clé, sans garantie), MapTiler (clé, offre gratuite limitée), serveur personnel. `tile.openstreetmap.org` exclu (politique OSMF). |
| M4 | **Monorepo npm** (`apps/mobile`, `packages/shared`) | Logique pure testée une seule fois (Vitest) et consommée par l'application. |
| M5 | Serveur = **PostgreSQL RPC** (conservé) | Atomicité, verrous par partie, aucune infrastructure supplémentaire, testable avec PGlite. |
| M6 | Positions brutes dans le **schéma privé**, diffusion **arrondie** | Confidentialité par conception (voir SECURITY.md). |
| M7 | **Consentement côté serveur** | Le serveur refuse le lancement et toute position sans accord enregistré. |
| M8 | **Client web retiré** (étiquette `v0.1.0-web`) | Un client web ne peut pas suivre en arrière-plan ; l'administration (quotas, nettoyage) est dans l'application et le tableau de bord Supabase. |
| M9 | Envoi de **la position la plus récente seulement** | Pas de file hors ligne : des positions anciennes seraient trompeuses et rejetées par l'anti-triche. |

## Flux d'une position

1. Le GPS fournit une mesure (premier plan : `watchPositionAsync`, intervalle de la partie ; arrière-plan : `startLocationUpdatesAsync`).
2. `GameController.submitFix` l'affiche immédiatement (« moi ») et envoie la plus récente via `report_position`, avec l'horodatage recalé sur l'horloge serveur.
3. Le serveur vérifie : participant, partie non terminée, joueur actif, **consentement**, coordonnées valides, horodatage (−2 min / +15 s), ordre, **vitesse plausible**, puis enregistre la position brute (privée).
4. Diffusion : coéquipiers (`pos`, arrondi 10 m) à chaque envoi ; adversaires (`enemy_pos`, arrondi `max(approx_m, précision GPS)`) au plus toutes les `enemy_refresh_s` (mode régulier) ou à chaque impulsion (mode impulsions). Fantôme = masqué ; Brouilleur = 150 m ; Leurre = position décalée ; préparation = Fugitifs invisibles des Chasseurs.
5. Zone : sortie signalée à tous (`zone_status`) ; Fugitif hors zone au-delà du délai → éliminé ; Chasseur hors zone → capture refusée.

## Machine à états

Inchangée (lobby → préparation → partie ⇄ pause → terminée → résultats), validée par le serveur. Le suivi GPS n'est actif que dans `preparation`, `running` et `paused`, pour un joueur `active`.

## Radar

Calculé par le serveur à partir des positions brutes fraîches : `direction` (cap 8 directions + distance arrondie à 50 m, depuis le barycentre de l'équipe ou le joueur en mode manuel), `sector` (8 secteurs centrés sur les points cardinaux × centre/périphérie de la zone), `zone` (cercle de ≥ 100 m contenant la cible, centre décalé au hasard). Contact `lost` si aucune position fraîche, `jammed` sous Brouilleur.

## Capture

Chasseur actif, dans la zone, position < 20 s et précision ≤ `max_accuracy_m` ; Fugitif(s) à ≤ `capture_radius_m` avec positions fraîches et précises → capturé(s). Recharge après chaque tentative.

## Modes

Classique (complet) et Infection (le capturé devient Chasseur, rotation du topic Fugitif). Mister X / Royale : structure de configuration prête (registre `MODES`), non développés.

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `supabase/migrations/20261118000800_real_world_gps.sql` | modèle GPS, confidentialité, consentement, radar/captures/capacités GPS, rétention |
| `packages/shared/src/controller.ts` | contrôleur de partie (séquences, resynchronisation, envoi GPS) |
| `packages/shared/src/layers.ts` | couches cartographiques (zone, joueurs, précision, radar) |
| `apps/mobile/src/lib/location/tracking.ts` | suivi GPS premier plan / arrière-plan, arrêts automatiques |
| `apps/mobile/src/app/game/[id]/index.tsx` | écran de jeu |
| `apps/mobile/app.config.ts` | permissions natives et plugins |
