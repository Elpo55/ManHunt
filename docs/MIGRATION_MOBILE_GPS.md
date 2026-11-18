# Audit et plan de migration — application mobile GPS

Date : 18 novembre 2026. Ce document précède toute modification.

## 0. Sauvegardes effectuées avant migration

| Élément | Où |
|---------|----|
| Version web stable (grille virtuelle, 87 tests verts) | étiquette Git **`v0.1.0-web`** (commit `86256e2`) |
| Travail inachevé « carte réelle web » (MapLibre GL JS, zone géographique) | branche **`archive/web-real-world-map`** |

Rien n'est perdu : `git checkout v0.1.0-web` restaure l'application web complète.

## 1. Inventaire de l'existant

| Bloc | Contenu | Taille |
|------|---------|--------|
| Frontend web | Next.js 16 export statique, 17 pages, design system, carte canvas (grille), PWA | ~7 800 lignes (`src/`) |
| Backend | 7 migrations PostgreSQL : profils, salons, moteur autoritaire, radar, capacités, RLS, Realtime privé, rotation de topic | ~3 500 lignes |
| Tests | 87 tests (Vitest + PGlite) dont simulation 20 joueurs | ~1 700 lignes |
| Scripts / docs | test de charge réel, pg_cron, guides | — |

Technologies : Next.js, React 19, TypeScript, Tailwind 4, Radix, Supabase (Auth anonyme + e-mail, PostgreSQL, Realtime Broadcast privé), Vitest, PGlite.

## 2. Classement des composants

### Réutilisables tels quels (indépendants de la plateforme et de la carte)
- **Backend** : profils, salons, codes d'invitation, bannissement, transfert d'hôte, équipes, consentement à ajouter, machine à états, pause/reprise, abandon, déconnexions (heartbeat), victoire/égalité, statistiques, classements, rotation de topic, limitation de fréquence, compteurs d'usage, nettoyage, RLS et autorisation Realtime par audience.
- **Logique client pure** : séquenceur de flux (doublons/trous), horloge serveur, contrôleur de partie (resynchronisation), journal, codes d'erreur, configuration miroir, fournisseur de tuiles + style sombre (branche archivée), conversions géographiques.
- **Tests** base de données salons/sécurité/séquences ; tests unitaires séquenceur/horloge.

### Réutilisables après adaptation
- Radar : calcul serveur conservé, mais sur positions GPS (direction + distance en mètres) au lieu de cases.
- Captures : validation serveur conservée, critère = distance GPS réelle + précision suffisante.
- Capacités : le système (recharge, utilisations, notifications) est conservé ; les effets liés à la grille sont remplacés (voir §5).
- `get_game_view`, `tick`, `finish_game`, `start_game`.

### Incompatibles avec le nouveau concept
| Élément | Raison | Décision |
|---------|--------|----------|
| Grille virtuelle, `generate_map`, `move`, pas régénérés, brouillard par cases | les joueurs se déplacent physiquement | supprimés côté serveur (migration documentée), remplacés par `report_position` |
| Carte canvas web | carte réelle exigée | remplacée par MapLibre React Native |
| Capacités Accélération et Blocage | impossibles à appliquer à un déplacement réel ; Blocage inciterait à contourner physiquement | désactivées (lignes conservées, `enabled = false`), remplacées par Leurre et Sonar |
| Application web Next.js | l'objectif est une application installable ; un client web GPS serait limité (pas d'arrière-plan) | **retirée de `main`** après mise en place du mobile ; conservée par l'étiquette `v0.1.0-web`. L'administration (quotas, nettoyage) passe dans un écran admin de l'application + tableau de bord Supabase. |
| PWA, service worker, Cloudflare Pages | sans objet pour une application native | retirés avec le web |

## 3. Choix techniques (justifiés)

| Besoin | Choix | Justification |
|--------|-------|---------------|
| Application Android + iOS | **React Native + Expo SDK 58** (TypeScript) | réutilise React/TS et la logique existante ; Expo fournit permissions, localisation, tâches d'arrière-plan, stockage sécurisé, notifications, et EAS Build (compilation iOS sans Mac). |
| Mode d'exécution | **Development build / EAS** (pas Expo Go) | la carte MapLibre native et la localisation en arrière-plan ne fonctionnent pas dans Expo Go. |
| Carte | **@maplibre/maplibre-react-native 11** | moteur natif MapLibre, plugin Expo officiel, même spécification de style que MapLibre GL JS : le style sombre et les fournisseurs déjà écrits sont réutilisés. |
| Données cartographiques | **OpenStreetMap via OpenFreeMap** (défaut, sans clé), MapTiler ou serveur personnalisé interchangeables | `tile.openstreetmap.org` interdit l'usage applicatif intensif ; OpenFreeMap est gratuit mais sans garantie de service → fournisseur interchangeable par variable d'environnement. |
| Localisation | **expo-location** (+ **expo-task-manager** pour l'arrière-plan) | API standard, service de premier plan Android avec notification, mode « Toujours » iOS ; limites documentées §6. |
| Session | **expo-secure-store** (jeton) + AsyncStorage | jamais de clé secrète dans l'application ; seule la clé publique Supabase est embarquée. |
| Backend | **Supabase** conservé | toute l'autorité, la RLS et le Realtime privé existants restent valables. |
| Organisation du code | **npm workspaces** : `apps/mobile`, `packages/shared`, `supabase/` | une seule source pour la logique partagée et testée. |

Alternative écartée : Flutter (réécriture totale, perte de la logique TS testée) ; application native Swift/Kotlin séparée (deux bases de code).

## 4. Nouveau modèle de jeu (monde réel)

- **Zone de jeu** : cercle réel (centre + rayon 150 m – 3 km) choisi par l'hôte sur la carte ; bords affichés en permanence.
- **Positions** : GPS réel, envoyé toutes les `position_interval_s` (défaut 5 s) **uniquement pendant une partie active et après consentement**.
- **Visibilité** (règle fondamentale) :
  - coéquipiers : position arrondie à ~10 m, actualisée en continu ;
  - adversaires : position **approximative** (arrondie à `approx_m`, défaut 30 m, jamais plus précise que la précision GPS réelle), actualisée au plus toutes les `enemy_refresh_s` (défaut 15 s) en mode `live` ; en mode `pulse`, uniquement lors des impulsions radar ;
  - chaque position porte son horodatage serveur et sa précision ; au-delà de `stale_after_s` (défaut 45 s) elle est affichée **obsolète** (grisée, sans animation) ; un joueur déconnecté n'est jamais animé.
- **Capture** : un Chasseur déclenche « Capturer » ; le serveur valide si un Fugitif actif est à moins de `capture_radius_m` (défaut 15 m) selon des positions **fraîches** (< 20 s) et **précises** (≤ `max_accuracy_m`, défaut 35 m). Aucun contact physique requis.
- **Radar** : impulsions calculées par le serveur à partir des positions réelles : direction (8 caps), distance (proche < 100 m, moyenne < 300 m, loin), ou zone approximative ; brouillage possible.
- **Hors zone** : signalé à tous ; un Fugitif hors zone plus de `out_of_zone_grace_s` (défaut 60 s) est éliminé ; un Chasseur hors zone ne peut pas capturer.
- **Anti-triche** : vitesse implausible (> `max_speed_mps`, défaut 12 m/s ≈ 43 km/h) rejetée, horodatage futur ou trop ancien rejeté, fréquence limitée.

## 5. Capacités (MVP GPS)

| Capacité | Équipe | Effet |
|----------|--------|-------|
| Fantôme | Fugitifs | position masquée aux Chasseurs pendant N s (radar toujours actif) |
| Brouilleur | Fugitifs | position et radar adverses dégradés (précision 150 m) |
| Leurre | Fugitifs | les Chasseurs reçoivent une fausse position à ~150 m pendant N s |
| Scan | Chasseurs | position plus précise (÷3) des Fugitifs à moins de 250 m |
| Traqueur | Chasseurs | direction + distance du Fugitif le plus proche |
| Sonar | Chasseurs | nombre de Fugitifs à moins de 150 m |

Accélération et Blocage : désactivées (non pertinentes dans le monde réel).

## 6. Confidentialité, consentement et sécurité (dans l'architecture)

- **Consentement obligatoire** : chaque joueur accepte, dans le lobby, les consignes de sécurité et le partage de position pour la durée de la partie (`set_location_consent`). Le serveur **refuse de lancer** une partie tant qu'un membre n'a pas consenti, et refuse toute position d'un joueur non consentant.
- **Suivi limité à la partie** : l'application démarre le GPS au début de la partie et l'arrête automatiquement à la fin, à l'abandon, à la sortie de l'écran de jeu ou sur le **bouton d'arrêt de sécurité** (toujours visible). Le serveur refuse toute position hors d'une partie active.
- **Arrêt de sécurité** : `safety_stop` arrête le partage immédiatement, retire le joueur de la partie et **efface ses positions brutes**.
- **Stockage** : positions brutes dans le schéma `private` (non exposé par l'API, inaccessible aux clients) ; seules des positions arrondies sont diffusées ; positions brutes **supprimées 24 h après la fin de la partie** (durée configurable) ; l'historique conservé pour les résultats est approximatif.
- **Accès** : canaux Realtime privés par audience, RLS stricte, participants uniquement.
- **Règles affichées avant chaque partie** : espaces publics uniquement, pas de propriété privée, pas de course sur la chaussée, respect du code de la route, arrêt possible à tout moment, pas de suivi hors jeu.
- **Pause / fin immédiate** par l'hôte ; la pause suspend aussi les captures.

### Limites de l'arrière-plan (documentées, comportement de secours)
- **iOS** : nécessite l'autorisation « Toujours » ; le système peut espacer les mises à jour ; si l'application est fermée par l'utilisateur, le suivi s'arrête.
- **Android** : service de premier plan avec notification permanente pendant la partie ; certains constructeurs (économie d'énergie agressive) peuvent suspendre l'application.
- **Secours** : si l'arrière-plan est refusé ou interrompu, le suivi continue au premier plan (écran maintenu allumé en option) ; les autres joueurs voient la position devenir **obsolète** ; au-delà du délai de grâce, abandon automatique (règle existante).

## 7. Plan de migration par étapes

| Étape | Contenu | Vérification |
|-------|---------|--------------|
| 0 | Sauvegardes (étiquette + branche) | ✅ fait |
| 1 | Migration SQL `0800_real_world_gps` : configuration GPS, zone, consentement, positions privées, `report_position`, captures/radar/capacités GPS, vue de partie, sécurité, rétention ; suppression documentée des fonctions de grille | tests PGlite réécrits + anciens tests salons/sécurité inchangés |
| 2 | `packages/shared` : logique pure réutilisée et adaptée (config, règles, géo, séquenceur, horloge, contrôleur, état, journal, fournisseurs de carte, style) | tests unitaires |
| 3 | `apps/mobile` (Expo) : authentification, profil, salons, lobby, consentement, configuration et zone, équipes, jeu (carte plein écran, GPS, radar, capacités, chrono, sécurité), résultats, statistiques, classement, réglages, permissions | typecheck, lint, bundle Metro Android/iOS |
| 4 | Retrait de l'application web de `main` (conservée par l'étiquette) | dépôt propre |
| 5 | Test de charge adapté au GPS, documentation complète | — |
| 6 (vous) | Comptes Supabase/Expo/Apple/Google, builds EAS, tests terrain | REMAINING_TASKS.md |

Priorité : **mode Classique complet avec GPS réel**. Infection reste fonctionnel (logique serveur existante) ; Mister X et Royale restent prévus (structure de configuration prête, non développés).

## 8. Risques de régression

| Risque | Mesure |
|--------|--------|
| Casser salons/lobby/sécurité | migrations additives ; tests existants conservés et exécutés |
| Données GPS sensibles | schéma privé, arrondi, rétention, tests RLS dédiés |
| Comportements natifs non testables ici (GPS réel, arrière-plan) | logique isolée et testée ; procédure de test terrain détaillée ; aucun test terrain prétendu |
| Coûts | Supabase Free, OpenFreeMap, EAS Free ; **iOS sur appareil réel = compte Apple Developer payant (99 $/an)** ou un Mac (installation locale 7 jours) → décision à prendre par vous |
| Dépendance au fournisseur de tuiles | fournisseur interchangeable par configuration |
