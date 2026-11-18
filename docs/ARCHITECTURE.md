# Architecture

Ce document décrit l'architecture technique et les décisions importantes (avec leur justification).

## Vue d'ensemble

```
 Téléphones / navigateurs (2 à 20 joueurs)
 ┌──────────────────────────────────────────┐
 │ Application web statique (Next.js export) │  ← Cloudflare Pages (CDN, gratuit)
 │  - interface, carte canvas, contrôles     │
 │  - GameController : état, séquenceur,     │
 │    horloge serveur, resynchronisation     │
 └───────────────┬──────────────────────────┘
        HTTPS (RPC)│   WebSocket (Realtime, canaux PRIVÉS)
 ┌───────────────▼──────────────────────────┐
 │ Supabase                                  │
 │  Auth (invités anonymes + e-mail)         │
 │  PostgREST → fonctions RPC security definer│ ← AUTORITÉ DU JEU
 │  PostgreSQL : tables + RLS                 │
 │  Realtime Broadcast (émis depuis la base) │
 └───────────────────────────────────────────┘
```

Aucun serveur applicatif permanent, aucun serveur local, aucune dépendance au NAS.

## Décisions techniques

| # | Décision | Pourquoi |
|---|----------|----------|
| D1 | **Next.js 16 en export statique** (`output: "export"`) | Seule configuration Next.js 100 % compatible Cloudflare Pages gratuit sans adaptateur (`@cloudflare/next-on-pages` est déprécié ; OpenNext cible Workers). Toute la logique serveur est dans Supabase, aucun rendu serveur n'est nécessaire. |
| D2 | **Routes à paramètres** (`/lobby/?room=…`, `/game/?id=…`) | L'export statique interdit les routes dynamiques sans liste connue au build. |
| D3 | **Logique de jeu en fonctions PostgreSQL** (RPC `security definer`) plutôt qu'en Edge Functions | Transactions atomiques et verrous natifs (`FOR UPDATE`), latence minimale (pas d'aller-retour Edge→DB), aucun quota d'invocations, testable localement avec PGlite. Les Edge Functions ne sont pas nécessaires au MVP. |
| D4 | **Ticks paresseux** au lieu d'une boucle serveur | Sans serveur permanent, les échéances (fin de préparation, radar, fin de partie, abandons) sont résolues par `private.tick()` : appelée au début de chaque action, par `game_tick()` que chaque client déclenche juste après l'échéance (avec gigue), et par le heartbeat (15 s). Idempotente et sérialisée par verrou. Option : `supabase/optional/pg_cron_jobs.sql` pour faire avancer les parties même sans aucun client. |
| D5 | **Broadcast émis depuis la base** (`realtime.send`) | Les messages ne partent que si la transaction réussit : pas d'événement fantôme. Les clients n'ont **aucun** droit de diffusion (politique RLS). |
| D6 | **Topics par audience** : `game:<id>:all`, `game:<id>:hunter`, `game:<id>:fugitive[:e<n>]`, `game:<id>:p:<uid>`, `room:<id>` | L'isolation des équipes est garantie par l'autorisation Realtime (RLS sur `realtime.messages`), pas par le client. |
| D7 | **Numéros de séquence par flux** | Détection des doublons, des messages en retard et des trous → resynchronisation complète via `get_game_view`. |
| D8 | **Déplacements par « pas » régénérés** (réserve configurable) | Un déplacement multi-cases = 1 message. Limite naturellement le débit Realtime (quota gratuit : 100 msg/s). |
| D9 | **Visibilité diffusée uniquement sur changement** | `refresh_vis` compare avec la dernière liste envoyée. |
| D10 | **Carte générée côté serveur** (graine, bâtiments, zones interdites, connexité garantie par BFS) | Le client ne peut pas tricher sur la carte ; la carte n'est pas secrète. |
| D11 | **Avatars géométriques générés** | Aucun stockage de fichiers (quota), identité visuelle originale. |
| D12 | **Rotation du topic Fugitif** (mode Infection) | L'autorisation Realtime n'est vérifiée qu'à l'abonnement : un joueur infecté pourrait sinon garder l'écoute de son ancienne équipe. |
| D13 | **Nom provisoire configurable** `NEXT_PUBLIC_APP_NAME` (défaut « Projet Traque ») | Aucun nom définitif validé. Le manifeste PWA est régénéré au build. |

## Machine à états

```
 Salon (room.status)          Partie (games.phase)
 ┌───────┐ start_game  ┌─────────────┐ échéance ┌─────────┐  fin / victoire  ┌──────────┐
 │ lobby ├────────────►│ preparation ├─────────►│ running ├─────────────────►│ finished │
 └───▲───┘ (prep=0 ──► running)  │ ▲ pause/resume │  ▲                     └────┬─────┘
     │                            ▼ │              ▼  │                          │
     │                         ┌──────┐◄───────────┘  │                          │
     │                         │paused├───────────────┘ abort ─► finished         │
     │  return_to_lobby        └──────┘                                          ▼
     └──────────────────────────────────────────── results (room.status) ◄───────┘
```

Toutes les transitions sont validées par le serveur (`E_INVALID_TRANSITION`). La même table est reproduite dans `src/lib/engine/rules.ts` (tests unitaires).

## Modèle de données (résumé)

| Table | Rôle | Lecture (RLS) | Écriture |
|-------|------|---------------|----------|
| `profiles` | pseudo, avatar, agrégats de stats, `is_admin` | tous les connectés | RPC `update_my_profile`, fin de partie |
| `rooms` | salon, code, hôte, config | membres | RPC |
| `room_members` | appartenance, équipe, prêt, dernier signe de vie | membres | RPC |
| `room_bans` | exclusions définitives | hôte | RPC |
| `games` | partie : phase, config figée, carte, échéances | participants / membres (colonnes techniques masquées) | RPC |
| `player_states` | position, pas, effets, statut | soi + coéquipiers ; tout le monde après la fin | RPC |
| `game_events` | journal append-only par flux (`stream`, `sn`) | flux autorisés ; tout après la fin | RPC |
| `abilities` | catalogue des capacités | tous | migration |
| `ability_usage` | activations (recharge, utilisations) | équipe ; tout après la fin | RPC |
| `radar_pulses` | impulsions radar calculées (unicité `(game, team, index)`) | équipe ; tout après la fin | RPC |
| `map_effects` | cases bloquées temporaires | participants | RPC |
| `game_statistics` | résultat individuel figé | tous les connectés | fin de partie |
| `saved_game_configs` | configurations enregistrées | propriétaire | propriétaire (max 20) |
| `private.rate_limits`, `private.usage_daily` | limitation de fréquence, compteurs d'usage | personne | serveur |

Migrations versionnées : `supabase/migrations/2026111800XXXX_*.sql`, à appliquer dans l'ordre.

## Synchronisation

**Événementielle** (immédiate) : connexion/déconnexion, déplacement, capture, capacité, changement de phase, fin de partie.

**Périodique** (référence temporelle serveur) : impulsions radar automatiques à `next_radar_at`, fin de préparation, fin de partie, expiration des effets.

Côté client (`src/lib/game/controller.ts`) :
1. `get_game_view` → état complet autorisé + positions des flux.
2. Abonnement aux 3 canaux privés ; à chaque (ré)abonnement → resynchronisation.
3. Chaque message passe dans `StreamSequencer` : doublon/retard → ignoré ; trou → mise en attente puis resynchronisation après 1,5 s.
4. Horloge : `server_time()` (échantillons NTP simplifiés) ; tous les chronomètres utilisent `clock.now()`.
5. Reconnexion : backoff exponentiel par canal, resynchronisation au retour au premier plan / retour du réseau.

## Règles de jeu (mode Classique)

- Préparation : les Fugitifs se déplacent, les Chasseurs sont immobiles et aveugles.
- Déplacement 4 directions, chemin validé case par case (obstacles, zones interdites, cases bloquées, bornes).
- Pas : réserve `max_steps`, +1 toutes les `step_regen_ms` (×2 sous Accélération).
- Vision : disque `dx² + dy² ≤ r² + r` autour de chaque coéquipier actif (Fantôme = invisible).
- Capture : action explicite d'un Chasseur ; capture tous les Fugitifs actifs à distance de Tchebychev ≤ `capture_range` (même invisibles). Recharge après chaque tentative.
- Victoire : Chasseurs si plus aucun Fugitif actif ; Fugitifs si le temps s'écoule avec au moins un survivant, ou si tous les Chasseurs ont abandonné ; égalité si plus personne / interruption.
- Score : Chasseur = 100 × captures + 200 si victoire ; Fugitif = secondes de survie + 300 si encore libre à la fin + 100 si victoire ; abandon = 0.
- Infection : le Fugitif capturé devient Chasseur (mêmes conditions de victoire).

## Radar

- Automatique (toutes les `interval_s`, origine = barycentre de l'équipe) ou manuel (recharge et utilisations par équipe, origine = joueur).
- Précisions : **direction** (8 caps + bande de distance), **secteur** (grille 3×3 ou 4×4), **zone** (carré décalé aléatoirement contenant la cible).
- Les contacts sont anonymes et mélangés ; un Fugitif sous Brouilleur apparaît « Signal brouillé ».
- L'équipe adverse reçoit `radar_ping` (sait qu'une impulsion a eu lieu, sans le résultat).

## Capacités (MVP : 3 + 3)

| Capacité | Équipe | Effet | Défaut |
|----------|--------|-------|--------|
| Fantôme | Fugitifs | invisible sur la carte adverse (pas au radar ni au Scan) | 12 s, recharge 75 s, 2 utilisations |
| Brouilleur | Fugitifs | radar et Traqueur adverses brouillés | 45 s, 120 s, 2 |
| Accélération | Fugitifs | +2 pas, régénération ×2 | 15 s, 60 s, illimité |
| Scan | Chasseurs | révèle les Fugitifs dans un rayon 2 autour d'une case à ≤ 7 ; alerte les Fugitifs repérés | 8 s, 45 s, illimité |
| Traqueur | Chasseurs | cap + distance du Fugitif le plus proche | instantané, 60 s, 3 |
| Blocage | Chasseurs | ferme une case à ≤ 4 pour tous | 40 s, 50 s, illimité |

Ajouter une capacité : ligne dans `public.abilities` (migration), branche dans `use_ability`, métadonnées dans `src/lib/engine/rules.ts` et `ABILITY_DEFAULTS`.

## Ajouter un mode de jeu

1. Ajouter la valeur à `games_mode_check` et à `normalize_config` (migration).
2. Brancher la règle spécifique (`attempt_capture`, `check_victory`, `tick` pour une zone qui se resserre…).
3. Passer `available: true` dans `MODES` (`src/lib/engine/rules.ts`).

## Règle de transfert d'hôte

Quand l'hôte quitte le salon (ou est inactif plus de 3 minutes en lobby), le rôle passe au **membre restant le plus ancien** (`joined_at` le plus petit). Si le salon est vide, il est fermé. L'hôte peut aussi transmettre le rôle manuellement.
