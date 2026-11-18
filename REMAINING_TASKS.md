# Ce qu'il vous reste à faire

Légende :
- `[ ]` À faire par vous
- `[x]` Déjà effectué par Claude Code (vérifié)
- `[ ] (à vérifier)` À vérifier par vous
- `[!]` Bloqué par une intervention externe (compte, identifiants, appareils)

Durée totale estimée : **1 h à 1 h 30** pour avoir le jeu en ligne, puis une soirée de test avec vos amis.

---

## Déjà fait (pour information)

- [x] Projet Next.js + TypeScript + Tailwind créé, design system, 17 pages, PWA (manifeste, icônes, service worker).
- [x] Base de données complète en 7 migrations versionnées (`supabase/migrations/`) : tables, RLS, moteur de jeu, radar, capacités, sécurité Realtime.
- [x] 87 tests automatisés écrits et **exécutés avec succès** (unitaires + PostgreSQL réel via PGlite, dont une simulation à 20 joueurs).
- [x] Typecheck, lint (0 erreur) et build de production réussis.
- [x] Dépôt Git local initialisé sur la branche `main` avec commits.
- [x] Fichiers `.env.example` et `.env.local` (vide, ignoré par Git) créés.
- [x] Script de test de charge réel prêt (`scripts/load-test.mjs`).

Rien n'a été créé chez Supabase, Cloudflare ou GitHub : ces étapes exigent **vos** comptes.

---

## 1. Comptes et services externes

### 1.1 [!] Créer le compte et le projet Supabase
- **Objectif** : héberger la base de données, l'authentification et le temps réel.
- **Pourquoi** : c'est le serveur du jeu ; sans lui rien ne fonctionne. Bloqué tant que vous n'avez pas de compte.
- **Actions** : [SETUP_GUIDE.md](SETUP_GUIDE.md) étapes **1 et 2** (supabase.com → *Start your project* → *New project*, plan **Free**, région Europe, mot de passe généré et conservé).
- **À récupérer** : le mot de passe de la base, le *Project ref* (`xxxx` dans `https://xxxx.supabase.co`).
- **Résultat attendu** : tableau de bord du projet affiché.
- **Vérification** : l'URL `https://supabase.com/dashboard/project/xxxx` s'ouvre.

### 1.2 [ ] Récupérer les deux clés publiques
- **Objectif** : permettre à l'application de joindre votre projet.
- **Actions** : SETUP_GUIDE **étape 3** — bouton **Connect** ou **Project Settings → Data API** (URL) et **Project Settings → API Keys** (clé *anon public* ou *Publishable key*).
- **À récupérer** : `https://xxxx.supabase.co` et la clé publique. **Pas** la clé `service_role` / secrète.
- **Vérification** : la clé publique commence par `eyJ` (anon) ou `sb_publishable_`.

### 1.3 [ ] Configurer l'authentification
- **Objectif** : autoriser le mode invité et les retours de connexion.
- **Actions** : SETUP_GUIDE **étape 7** :
  1. **Authentication → Sign In / Providers → Allow anonymous sign-ins : activé** → Save.
  2. Fournisseur **Email** : désactiver **Confirm email** (recommandé pour un groupe privé) → Save.
  3. **Authentication → URL Configuration** : Site URL `http://localhost:3000`, Redirect URL `http://localhost:3000/auth/callback/` (vous ajouterez l'URL de production en 3.4).
- **Vérification** : à l'étape 2.4, « Jouer en invité » fonctionne.

### 1.4 [ ] Restreindre Realtime aux canaux privés
- **Objectif** : empêcher toute écoute hors des règles d'autorisation.
- **Actions** : SETUP_GUIDE **étape 8** : **Realtime → Settings** → désactiver **Allow public access** → Save.
- **Vérification** : le lobby affiche « En direct » à l'étape 2.4 (si « Reconnexion… » en boucle : relire l'étape 2.2).

### 1.5 [ ] Créer un compte GitHub (si vous n'en avez pas) et un compte Cloudflare
- **Objectif** : héberger le code (privé) et le site.
- **Actions** : https://github.com/signup puis https://dash.cloudflare.com/sign-up (gratuits, sans carte).
- **Vérification** : vous pouvez vous connecter aux deux.

---

## 2. Configuration locale

### 2.1 [ ] Installer les dépendances
- **Pourquoi** : `node_modules` est déjà présent sur ce PC ; à refaire seulement sur une autre machine ou après suppression.
- **Actions** : dans un terminal à la racine du projet : `npm install`.
- **Vérification** : « found 0 vulnerabilities » ou équivalent, pas d'erreur.

### 2.2 [ ] Appliquer les migrations sur Supabase
- **Objectif** : créer tables, moteur de jeu et sécurité.
- **Actions** (SETUP_GUIDE **étape 5**, méthode A) :
  ```bash
  npx supabase login
  npx supabase link --project-ref xxxx
  npx supabase db push
  ```
  Ou méthode B : coller les 7 fichiers de `supabase/migrations/` dans l'ordre dans **SQL Editor** → Run.
- **Résultat attendu** : « Finished supabase db push ».
- **Vérification** : **Table Editor** montre 13 tables, toutes « RLS enabled » ; la table `abilities` contient 6 lignes.

### 2.3 [ ] Renseigner `.env.local`
- **Fichier** : `.env.local` à la racine (déjà créé, valeurs vides).
- **Actions** : remplir
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<clé publique>
  NEXT_PUBLIC_APP_NAME=Projet Traque
  ```
- **Vérification** : `git status` ne liste pas `.env.local` (il est ignoré).

### 2.4 [ ] Lancer l'application en local
- **Actions** : `npm run dev` puis ouvrir http://localhost:3000.
- **Résultat attendu** : page d'accueil sans le message « Serveur non configuré ».
- **Vérification** : *Commencer à jouer → Jouer en invité* → choix du pseudo → *Créer un salon* → le lobby affiche un code à 6 caractères et « En direct ».

### 2.5 [ ] (Recommandé) Lancer le test de charge réel
- **Objectif** : mesurer latence et stabilité avec 20 clients réels.
- **Actions** : `npm run test:load` (voir [TESTING_GUIDE.md](TESTING_GUIDE.md) §2).
- **Vérification** : dernière ligne « ✓ Aucun problème bloquant détecté. » Envoyez-moi la sortie si ce n'est pas le cas.

---

## 3. Déploiement

### 3.1 [ ] Pousser le code sur GitHub (dépôt privé)
- **Actions** ([DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) §1) :
  ```bash
  gh auth login
  gh repo create projet-traque --private --source . --remote origin --push
  ```
- **Vérification** : le dépôt existe sur GitHub, en **Private**, sans fichier `.env.local`.

### 3.2 [ ] Créer le projet Cloudflare Pages
- **Actions** (DEPLOYMENT_GUIDE §2) : **Workers & Pages → Create → Pages → Connect to Git** → dépôt `projet-traque` → Build command `npm run build`, Build output directory `out`, Production branch `main`.
- **Vérification** : l'écran de configuration est validé.

### 3.3 [ ] Définir les variables de production puis déployer
- **Actions** : dans *Environment variables* : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_NAME`, `NODE_VERSION=22` → **Save and Deploy**.
- **Résultat attendu** : déploiement « Success » et une URL `https://projet-traque.pages.dev`.
- **Vérification** : l'URL affiche l'accueil sans « Serveur non configuré ».

### 3.4 [ ] Déclarer l'URL de production dans Supabase
- **Actions** : **Authentication → URL Configuration** : Site URL = URL Cloudflare ; ajouter `https://<votre-site>/auth/callback/` aux Redirect URLs.
- **Vérification** : la création d'un compte e-mail depuis le site en ligne fonctionne.

### 3.5 [ ] (à vérifier) Domaine
- Par défaut `*.pages.dev` suffit. Domaine personnalisé facultatif (DEPLOYMENT_GUIDE §7).

---

## 4. Tests réels

### 4.1 [!] Installer l'application sur votre téléphone
- **Bloqué** : nécessite le site déployé (3.3) et votre téléphone.
- **Actions** : Android/Chrome : menu ⋮ → *Installer l'application* ; iPhone/Safari : Partager → *Sur l'écran d'accueil*.
- **Vérification** : l'icône « réticule » est sur l'écran d'accueil et s'ouvre en plein écran.

### 4.2 [!] Rejoindre une partie avec plusieurs appareils
- **Bloqué** : nécessite d'autres appareils / amis.
- **Actions** : TESTING_GUIDE §3 puis §7.
- **Vérification** : présence en ligne et équipes synchronisées sur tous les appareils.

### 4.3 [ ] Vérifier le radar
- TESTING_GUIDE §4 (intervalle 15 s pour tester vite). **Vérification** : impulsions simultanées, chronos identiques.

### 4.4 [ ] Tester les déconnexions
- TESTING_GUIDE §5 (mode avion 20 s, 60 s, puis au-delà du délai d'abandon). **Vérification** : reconnexion et resynchronisation automatiques, abandon après le délai.

### 4.5 [ ] Tester une partie complète
- TESTING_GUIDE §7, en remplissant la fiche de relevé. **Vérification** : résultats identiques sur tous les appareils. Remontez-moi les lignes KO.

---

## 5. Administration

### 5.1 [ ] Créer votre compte administrateur
- **Pourquoi** : accéder au suivi de consommation et au nettoyage.
- **Actions** (SETUP_GUIDE §10) : jouer une fois pour créer votre profil → **Authentication → Users** → copier votre *User UID* → **SQL Editor** :
  ```sql
  update public.profiles set is_admin = true where id = 'VOTRE-USER-UID';
  ```
  Conseil : utilisez un **compte e-mail** (pas invité) pour ne pas perdre ce profil.
- **Vérification** : **Réglages** affiche « Administration : consommation des quotas ».

### 5.2 [ ] Comprendre les permissions
- Joueurs : rejoignent, choisissent leur équipe si autorisé, jouent, quittent.
- Hôte (créateur du salon) : règles, équipes, lancement, pause, interruption, exclusion, transfert du rôle.
- Administrateur : uniquement la consommation et le nettoyage ; il n'a **aucun** pouvoir de triche en partie.
- Tout est appliqué par le serveur ; voir [docs/SECURITY.md](docs/SECURITY.md).

### 5.3 [ ] Comprendre la gestion des salons
- Un hôte peut avoir 3 salons ouverts au maximum ; un salon accepte 2 à 20 joueurs.
- Si l'hôte part (ou est inactif 3 min dans le lobby), le joueur présent depuis le plus longtemps devient hôte.
- On ne peut pas rejoindre un salon pendant une partie ; on rejoint la suivante.
- Les salons inactifs depuis 7 jours sont fermés par le nettoyage.

### 5.4 [ ] Comprendre les limites du forfait gratuit
- Lire [docs/QUOTAS.md](docs/QUOTAS.md). Points clés :
  - 100 messages temps réel par seconde : gardez une régénération des pas ≥ 1 s à 20 joueurs.
  - Environ 40 parties actives de 15 min à 20 joueurs par mois avant d'approcher 2 millions de messages (estimation).
  - **Un projet gratuit inactif ~7 jours est mis en pause** : avant une soirée de jeu, ouvrez le tableau de bord Supabase et cliquez sur **Restore project** si nécessaire.
  - Aucun dépassement n'est facturé sur le forfait Free.

### 5.5 [ ] (Optionnel) Activer les tâches planifiées
- SETUP_GUIDE §9 : `supabase/optional/pg_cron_jobs.sql` dans **SQL Editor**.
- **Vérification** : `select * from cron.job;` liste `pt-tick` et `pt-cleanup`.

### 5.6 [ ] (Optionnel) Choisir le nom définitif
- Changez `NEXT_PUBLIC_APP_NAME` dans `.env.local` et dans Cloudflare, puis redéployez. Aucun nom définitif n'a été imposé.

---

## Si vous voulez que je continue

Envoyez-moi :
1. la sortie de `npx supabase db push` (ou une capture des tables) ;
2. la sortie de `npm run test:load` ;
3. la fiche de relevé de la première partie réelle.

Ne m'envoyez **jamais** la clé `service_role` / secrète ni le mot de passe de la base.
