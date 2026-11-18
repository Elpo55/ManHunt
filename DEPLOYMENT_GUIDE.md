# Guide de déploiement

Cible : **Cloudflare Pages** (gratuit), site 100 % statique généré par `npm run build` dans le dossier `out/`. Le backend reste Supabase (voir [SETUP_GUIDE.md](SETUP_GUIDE.md)).

Prérequis : le projet Supabase est configuré (migrations appliquées) et vous avez un compte GitHub.

---

## 1. Publier le code sur GitHub

Le dépôt Git local existe déjà (branche `main`, commits faits). Il reste à créer le dépôt distant **privé** et à pousser.

### Avec GitHub CLI (installée sur votre PC)

```bash
gh auth login                        # si ce n'est pas déjà fait : GitHub.com > HTTPS > navigateur
gh repo create projet-traque --private --source . --remote origin --push
```

### Sans CLI

1. https://github.com/new → **Repository name** : `projet-traque` → **Private** → ne cochez rien d'autre → **Create repository**.
2. Dans le terminal, à la racine du projet :
   ```bash
   git remote add origin https://github.com/<votre-compte>/projet-traque.git
   git push -u origin main
   ```

✅ Vérification : le dépôt GitHub affiche les fichiers ; `.env.local` n'y figure **pas**.

## 2. Créer le projet Cloudflare Pages

1. Créez un compte gratuit sur https://dash.cloudflare.com/sign-up (aucun moyen de paiement requis pour Pages).
2. Menu **Workers & Pages** → **Create** (ou *Create application*) → onglet **Pages** → **Connect to Git** (*Import an existing Git repository*).
   - Si Cloudflare vous propose de créer un *Worker*, choisissez bien l'onglet **Pages**.
3. **Connect GitHub** → autorisez l'application Cloudflare sur le dépôt `projet-traque` uniquement → sélectionnez-le → **Begin setup**.
4. **Set up builds and deployments** :
   | Champ | Valeur |
   |-------|--------|
   | Project name | `projet-traque` (donnera `https://projet-traque.pages.dev`) |
   | Production branch | `main` |
   | Framework preset | **None** (ou *Next.js (Static HTML Export)*) |
   | Build command | `npm run build` |
   | Build output directory | `out` |
   | Root directory | *(vide)* |
5. Déroulez **Environment variables (advanced)** et ajoutez (type *Text*, pas *Secret* : ce sont des valeurs publiques) :
   | Variable | Valeur |
   |----------|--------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | votre clé publique |
   | `NEXT_PUBLIC_APP_NAME` | `Projet Traque` (ou le nom choisi) |
   | `NODE_VERSION` | `22` |
6. **Save and Deploy**. Le premier build prend 2 à 4 minutes.

> Les variables `NEXT_PUBLIC_*` sont intégrées **au moment du build**. Après toute modification, relancez un déploiement (étape 5).

## 3. Autoriser l'URL de production dans Supabase

Supabase → **Authentication → URL Configuration** :
- **Site URL** : `https://projet-traque.pages.dev` (ou votre domaine).
- **Redirect URLs** : ajoutez `https://projet-traque.pages.dev/auth/callback/`.

## 4. Vérifier le déploiement

1. Ouvrez `https://projet-traque.pages.dev` : la page d'accueil s'affiche **sans** le message « Serveur non configuré ».
2. **Commencer à jouer → Jouer en invité** → choisir un pseudo → accueil connecté.
3. **Créer un salon** → le lobby affiche le code et « En direct » (point vert).
4. Sur un second appareil (ou fenêtre privée) : ouvrez le lien d'invitation → le joueur apparaît dans le lobby du premier en moins d'une seconde.
5. Outils du navigateur (F12) → **Console** : aucune erreur rouge liée à la CSP ou à Supabase.
6. En-têtes de sécurité : onglet **Réseau** → document principal → *Content-Security-Policy* présent.
7. Installation : sur Android/Chrome, l'option « Installer l'application » apparaît ; sur iPhone, Safari → Partager → « Sur l'écran d'accueil ».

## 5. Mettre à jour l'application

- **Automatique** : chaque `git push` sur `main` déclenche un nouveau build (500 builds/mois gratuits).
  ```bash
  git add -A && git commit -m "…" && git push
  ```
- **Manuel** : Cloudflare → projet → **Deployments** → **Retry deployment** / *Create deployment*.
- **Base de données** : toute évolution du schéma passe par une **nouvelle** migration dans `supabase/migrations/` (jamais en modifiant une migration déjà appliquée), puis `npx supabase db push`. Appliquez la migration **avant** de déployer le frontend qui en dépend.

## 6. Revenir à une version précédente

- **Frontend** : Cloudflare → projet → **Deployments** → sur un déploiement réussi précédent : menu **⋯** → **Rollback to this deployment**. Effet immédiat.
- **Code** : `git revert <commit>` puis `git push` (historique conservé).
- **Base de données** : Supabase n'annule pas automatiquement une migration. Écrivez une migration corrective. Les sauvegardes quotidiennes avec restauration ponctuelle ne font pas partie du forfait gratuit : exportez si besoin via **Database → Backups** (selon disponibilité) ou `npx supabase db dump -f sauvegarde.sql`.

## 7. Domaine personnalisé (optionnel)

Cloudflare → projet → **Custom domains** → **Set up a custom domain** → suivez les instructions DNS. Ajoutez ensuite le nouveau domaine dans Supabase (étape 3).

## Alternative sans Git : envoi direct

```bash
npm run build
npx wrangler pages deploy out --project-name projet-traque
```
(`wrangler login` ouvre le navigateur ; les variables `NEXT_PUBLIC_*` doivent alors être dans `.env.local` au moment du build.)

## Autres hébergeurs compatibles

Le dossier `out/` est un site statique standard : Netlify, GitHub Pages, Vercel… fonctionnent aussi. Sur ces hébergeurs, recopiez l'équivalent des en-têtes de `public/_headers`.
