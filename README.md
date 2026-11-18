# Projet Traque (nom provisoire)

Jeu de traque multijoueur **privé**, joué entre amis depuis leurs téléphones : les **Chasseurs** doivent capturer les **Fugitifs** sur une carte virtuelle à informations cachées, rythmée par des impulsions radar et des capacités spéciales.

Toutes les positions sont **virtuelles** : aucune géolocalisation, aucun GPS, aucune poursuite physique.

> Le nom affiché se règle avec `NEXT_PUBLIC_APP_NAME` (défaut : « Projet Traque »).

## Fonctionnalités

- **Comptes** : mode invité (sans e-mail) ou compte e-mail ; un invité peut lier un e-mail pour conserver son profil. Pseudo + emblème généré.
- **Salons privés** : code d'invitation à 6 caractères, lien de partage, liste des joueurs avec présence en ligne, choix des équipes (si l'hôte l'autorise), état « prêt ».
- **Hôte** : règles complètes, répartition des équipes (manuelle ou aléatoire), démarrage, pause/reprise, interruption, exclusion (avec interdiction de revenir), transfert du rôle ; transfert automatique documenté si l'hôte part.
- **Modes** : Classique et Infection (Mister X et Royale prévus par l'architecture).
- **Carte** : grille générée par le serveur (16², 22² ou 30²), bâtiments, zones interdites, cases bloquées dynamiques, brouillard de guerre, traces de déplacement, zoom/glisser, déplacement par toucher ou pas à pas, clavier sur ordinateur.
- **Radar** : automatique ou manuel, précision directionnelle / secteur / zone, équipes équipées, intervalle, recharge, utilisations et durée d'affichage configurables ; calcul et horodatage serveur.
- **Capacités** : Fantôme, Brouilleur, Accélération (Fugitifs) ; Scan, Traqueur, Blocage (Chasseurs) — durée, recharge, utilisations réglables.
- **Moteur** : machine à états explicite, chronomètre sur l'horloge serveur, captures, conditions de victoire, égalités, abandons, déconnexions avec délai de grâce, reconnexion et resynchronisation automatiques.
- **Après-partie** : résultats, classement de la partie, carte finale avec tous les trajets, chronologie ; statistiques personnelles, historique, classement privé.
- **PWA** installable (Android, iOS, Windows, macOS), interface mobile en priorité.
- **Administration** : mesure de la consommation des quotas et nettoyage des anciennes données.

## Architecture

```
Navigateur (Next.js statique, Cloudflare Pages)
   │ RPC HTTPS                     │ WebSocket Realtime (canaux privés)
   ▼                               ▼
Supabase : Auth · PostgreSQL (RLS + fonctions RPC = autorité du jeu) · Realtime Broadcast
```

Le serveur (PostgreSQL) est l'unique autorité : positions, captures, capacités, équipes, scores et état de la partie y sont validés et calculés. Les joueurs ne reçoivent que les informations autorisées pour leur équipe. Détails : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), [docs/QUOTAS.md](docs/QUOTAS.md).

## Technologies

Next.js 16 (export statique) · React 19 · TypeScript · Tailwind CSS 4 · Radix UI · lucide · Supabase (Auth, PostgreSQL 17, Realtime) · Vitest · PGlite (PostgreSQL WASM pour les tests).

## Structure

```
src/app/                 pages (accueil, connexion, profil, salons, lobby, jeu, résultats, stats…)
src/components/          design system (ui/), lobby/, game/ (carte canvas, contrôles, panneaux)
src/lib/engine/          règles partagées pures (config, grille, chemins, radar, états)
src/lib/game/            contrôleur de partie, état, journal
src/lib/realtime/        canaux privés + reconnexion, séquenceur, horloge serveur
supabase/migrations/     schéma, moteur de jeu, sécurité (migrations versionnées)
supabase/optional/       tâches pg_cron optionnelles
tests/unit/              tests du moteur client
tests/db/                tests SQL réels (PGlite) : salons, moteur, sécurité, simulation 20 joueurs
scripts/                 test de charge réel, icônes, manifeste
```

## Installation et lancement local

Prérequis : Node.js 20.9 ou plus récent (testé avec 24), un projet Supabase (voir [SETUP_GUIDE.md](SETUP_GUIDE.md)).

```bash
npm install
cp .env.example .env.local      # puis renseigner l'URL et la clé publique Supabase
npm run dev                     # http://localhost:3000
```

Pour jouer avec un téléphone sur le même réseau pendant le développement : `npx next dev -H 0.0.0.0` puis ouvrir `http://<IP-du-PC>:3000` (ajouter cette URL dans Supabase > Authentication > URL Configuration si vous utilisez des comptes e-mail).

## Configuration

| Variable | Rôle |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé publique (« anon » ou « publishable ») — protégée par la RLS |
| `NEXT_PUBLIC_APP_NAME` | nom provisoire affiché |

Jamais de clé `service_role` / secrète dans ce projet.

## Tests

```bash
npm test             # tout (unitaires + base de données PGlite)
npm run test:unit    # moteur client
npm run test:db      # migrations, RLS, Realtime, moteur, simulation 20 joueurs
npm run typecheck && npm run lint
npm run test:load    # test de charge RÉEL (nécessite un projet Supabase configuré)
```

Voir [TESTING_GUIDE.md](TESTING_GUIDE.md), y compris la procédure de test avec plusieurs téléphones.

## Déploiement

Build statique (`npm run build` → dossier `out/`) publié sur Cloudflare Pages. Voir [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

## Documents

- [REMAINING_TASKS.md](REMAINING_TASKS.md) — ce qu'il reste à faire de votre côté, pas à pas
- [SETUP_GUIDE.md](SETUP_GUIDE.md) — configuration Supabase
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) — mise en ligne
- [TESTING_GUIDE.md](TESTING_GUIDE.md) — tests automatisés et manuels
- [RAPPORT_FINAL.md](RAPPORT_FINAL.md) — bilan
- [CHANGELOG.md](CHANGELOG.md)
