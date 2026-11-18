# Guide de configuration des services externes

Durée : 20 à 30 minutes. Coût : 0 €. Aucune carte bancaire n'est demandée par Supabase pour le forfait gratuit.

> Les intitulés de menus ci-dessous correspondent à l'interface Supabase connue fin 2026. Si un libellé a légèrement changé, cherchez le terme indiqué entre guillemets dans la page.

---

## 1. Créer le compte Supabase

1. Ouvrez https://supabase.com et cliquez sur **Start your project** (ou **Sign in**).
2. Connectez-vous avec **Continue with GitHub** (recommandé, vous aurez besoin de GitHub pour le déploiement) ou par e-mail.
3. Si on vous demande de créer une **organisation** : nom libre (ex. « Perso »), **Type** : *Personal*, **Plan** : **Free** → **Create organization**.

✅ Vérification : vous voyez le tableau de bord `https://supabase.com/dashboard`.

## 2. Créer le projet

1. **New project**.
2. Renseignez :
   - **Organization** : celle créée ci-dessus (plan Free).
   - **Project name** : par exemple `projet-traque`.
   - **Database Password** : cliquez sur **Generate a password** et **conservez-le** dans un gestionnaire de mots de passe (utile pour la CLI).
   - **Region** : la plus proche de vos joueurs (ex. *West EU (Paris)* ou *Central EU (Frankfurt)*).
   - Laissez les options de sécurité par défaut (Data API activée).
3. **Create new project** et patientez 1 à 2 minutes.

✅ Vérification : la page du projet affiche « Project is ready » / l'écran d'accueil du projet.

## 3. Récupérer les identifiants

Vous avez besoin de **deux valeurs publiques** :

| Valeur | Où la trouver | Variable |
|--------|---------------|----------|
| URL du projet | bouton **Connect** en haut de la page du projet, ou **Project Settings → Data API → Project URL** | `NEXT_PUBLIC_SUPABASE_URL` |
| Clé publique | **Project Settings → API Keys** : onglet *Legacy API Keys* → **anon public**, ou la clé **Publishable key** (`sb_publishable_…`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

⚠️ Ne copiez **jamais** la clé **service_role** ni une **Secret key** (`sb_secret_…`) : elles contournent toute la sécurité.

Notez aussi le **Project ref** : la partie `xxxx` de `https://xxxx.supabase.co` (utile pour la CLI).

## 4. Placer les clés (développement local)

1. À la racine du projet, le fichier `.env.local` existe déjà avec des valeurs vides (sinon : copiez `.env.example` en `.env.local`).
2. Remplissez :
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...   (ou sb_publishable_...)
   NEXT_PUBLIC_APP_NAME=Projet Traque
   ```
3. Ce fichier est ignoré par Git : il ne sera jamais publié.

## 5. Appliquer les migrations (créer la base de données)

Les migrations créent les tables, le moteur de jeu, la sécurité et le catalogue des capacités. Deux méthodes, **choisissez-en une**.

### Méthode A — CLI Supabase (recommandée)

Dans un terminal, à la racine du projet :

```bash
npx supabase login                         # ouvre le navigateur pour autoriser la CLI
npx supabase link --project-ref xxxx       # remplacez xxxx ; demande le mot de passe de la base (étape 2)
npx supabase db push                       # applique supabase/migrations/* dans l'ordre
```

Répondez `Y` à la confirmation. ✅ Le message se termine par « Finished supabase db push ».

### Méthode B — Éditeur SQL (sans terminal)

1. Menu de gauche **SQL Editor** → **New query**.
2. Ouvrez dans l'ordre chaque fichier de `supabase/migrations/` (du `…000100…` au `…000700…`), copiez tout son contenu, collez, cliquez **Run**. Attendez « Success. No rows returned » avant de passer au suivant.
3. Ne relancez pas deux fois le même fichier.

✅ Vérification (les deux méthodes) : **Table Editor** liste les 13 tables `profiles`, `rooms`, `room_members`, `room_bans`, `games`, `player_states`, `game_events`, `abilities` (6 lignes), `ability_usage`, `radar_pulses`, `map_effects`, `game_statistics`, `saved_game_configs`. Chaque table affiche le badge **RLS enabled** (aucune ne doit être marquée « RLS disabled » / « Unrestricted »).

## 6. Politiques de sécurité

Les politiques RLS et les politiques Realtime sont **créées par les migrations** : rien à saisir à la main.

Contrôle : **Authentication → Policies** (ou **Database → Policies**) : chaque table `public.*` a au moins une politique ; le schéma `realtime` contient `realtime_read_authorized_topics` et `realtime_write_presence` sur `messages`.

## 7. Authentification

1. **Authentication → Sign In / Providers** (parfois **Authentication → Providers**) :
   - Section **User Signups** : **Allow anonymous sign-ins** → **activé** (indispensable pour le mode invité). **Save**.
   - Fournisseur **Email** : laissez activé. Pour un groupe d'amis, désactivez **Confirm email** (sinon chaque inscription envoie un e-mail via le service intégré, limité à quelques messages par heure). **Save**.
2. **Authentication → URL Configuration** :
   - **Site URL** : en local `http://localhost:3000` ; après déploiement, l'URL Cloudflare (ex. `https://projet-traque.pages.dev`).
   - **Redirect URLs** → **Add URL** : `http://localhost:3000/auth/callback/` et, après déploiement, `https://<votre-site>/auth/callback/`.
3. (Optionnel) **Authentication → Rate Limits** : « Rate limit for anonymous users » = 30/heure par IP par défaut. Augmentez-le (ex. 100) si beaucoup d'amis s'inscrivent depuis le même Wi-Fi.
4. (Optionnel) **Authentication → Attack Protection** : CAPTCHA si le lien circule hors de votre cercle.

## 8. Realtime

1. Ouvrez **Realtime → Settings** (selon la version : **Project Settings → Realtime**).
2. Désactivez **Allow public access** (« Channel restrictions » / « Private channels only ») pour que seuls les canaux privés autorisés par les politiques soient utilisables. **Save**.
3. Aucune autre configuration : les messages sont envoyés par la base (`realtime.send`), il n'y a pas de réplication de table à activer.

✅ Vérification : après une partie de test, **Realtime → Inspector** permet de rejoindre un canal ; un canal privé sans autorisation doit être refusé.

## 9. (Optionnel) Tâches planifiées

Pour que les parties se terminent même si tout le monde ferme l'application, et pour le nettoyage nocturne :

1. **Database → Extensions** → recherchez **pg_cron** → **Enable** (si ce n'est pas déjà fait).
2. **SQL Editor** → collez `supabase/optional/pg_cron_jobs.sql` → **Run**.

Coût : une requête toutes les 15 s, négligeable.

## 10. Créer votre compte administrateur

1. Lancez l'application (local ou en ligne), connectez-vous, choisissez votre pseudo.
2. Supabase → **Authentication → Users** : copiez votre **User UID**.
3. **SQL Editor** :
   ```sql
   update public.profiles set is_admin = true where id = 'VOTRE-USER-UID';
   ```
4. Rechargez l'application : **Réglages** affiche « Administration : consommation des quotas ».

## 11. Connecter le frontend

- **Local** : `.env.local` (étape 4) puis `npm run dev`.
- **Production** : variables d'environnement Cloudflare Pages (voir [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)).

✅ Vérification : la page d'accueil n'affiche plus « Serveur non configuré » ; **Jouer en invité** mène à la création du profil.

## 12. Déployer

Suivez [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

## Dépannage

| Symptôme | Cause probable | Solution |
|----------|----------------|----------|
| « Serveur non configuré » | variables absentes | étape 4 / variables Cloudflare, puis relancer `npm run dev` ou redéployer |
| « La connexion invité est désactivée » | anonymous sign-ins désactivé | étape 7.1 |
| « Erreur : Could not find the function public.create_room » | migrations non appliquées | étape 5 |
| Le lobby ne se met pas à jour / « Reconnexion… » en boucle | politiques Realtime absentes, ou canal public forcé | vérifier la migration 0600 ; étape 8 |
| « Trop de tentatives » à l'inscription | limite d'inscriptions anonymes par IP | étape 7.3 |
| Projet inaccessible après une semaine sans jeu | projet gratuit mis en pause | tableau de bord → **Restore project** |
