# Guide de configuration des services

Durée : ~45 min. Coût : 0 € (les seules options payantes, Apple et Google Play, sont signalées et facultatives au départ).

> Les noms de menus correspondent aux interfaces connues fin 2026. Si un libellé a changé, cherchez le terme entre guillemets dans la page.

---

## 1. Supabase (serveur du jeu)

### 1.1 Compte et projet
1. https://supabase.com → **Start your project** → **Continue with GitHub** (ou e-mail).
2. Organisation : **Type** *Personal*, **Plan** **Free**.
3. **New project** : nom `projet-traque`, **Database Password** → **Generate a password** (à conserver), **Region** la plus proche de vos joueurs (ex. *West EU (Paris)*), **Create new project**.

### 1.2 Identifiants (publics)
| Valeur | Où | Variable |
|--------|----|----------|
| URL | bouton **Connect** ou **Project Settings → Data API → Project URL** | `EXPO_PUBLIC_SUPABASE_URL` |
| Clé publique | **Project Settings → API Keys** : *anon public* (onglet *Legacy API Keys*) ou *Publishable key* `sb_publishable_…` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` |

⚠️ Jamais la clé **service_role** ni une **Secret key** (`sb_secret_…`). Notez aussi le *Project ref* (`xxxx` dans `https://xxxx.supabase.co`).

### 1.3 Créer la base (migrations)
À la racine du dépôt :
```bash
npx supabase login
npx supabase link --project-ref xxxx      # mot de passe de la base demandé
npx supabase db push                      # applique supabase/migrations/0100 → 0800
```
Sans terminal : **SQL Editor → New query**, collez chaque fichier de `supabase/migrations/` **dans l'ordre** (0100 à 0800), **Run** à chaque fois.

✅ **Table Editor** : 13 tables publiques, toutes « RLS enabled » ; `abilities` contient 8 lignes (dont 2 désactivées : `sprint`, `barrier`). Le schéma `private` contient `player_positions` et `position_history`.

### 1.4 Authentification
1. **Authentication → Sign In / Providers** :
   - **Allow anonymous sign-ins** : **activé** (mode invité).
   - **Email** : laissez activé ; désactivez **Confirm email** pour un groupe d'amis (le service d'e-mail intégré n'envoie que quelques messages par heure, et le lien de confirmation n'ouvre pas l'application).
2. **Authentication → Rate Limits** (facultatif) : augmentez « anonymous users » si beaucoup d'amis s'inscrivent depuis le même Wi-Fi.

### 1.5 Realtime
**Realtime → Settings** (ou **Project Settings → Realtime**) : désactivez **Allow public access** → **Save**. Les canaux privés et leurs autorisations sont créés par les migrations.

### 1.6 Tâches planifiées (recommandé pour la confidentialité)
**Database → Extensions → pg_cron → Enable**, puis **SQL Editor** : collez `supabase/optional/pg_cron_jobs.sql` → **Run**. Effet : effacement automatique quotidien des positions brutes (> 24 h après la partie) et fin des parties abandonnées par tous.

### 1.7 Compte administrateur
Après votre première connexion dans l'application : **Authentication → Users** → copiez votre *User UID*, puis **SQL Editor** :
```sql
update public.profiles set is_admin = true where id = 'VOTRE-USER-UID';
```
L'écran **Réglages** affiche alors la consommation des quotas.

---

## 2. Cartographie

Rien à faire par défaut : **OpenFreeMap** (tuiles OpenStreetMap, sans compte ni clé) est utilisé.

Option plus robuste (fournisseur avec engagement de service) — **MapTiler** :
1. https://cloud.maptiler.com → compte gratuit → **API Keys** → copiez la clé.
2. Restreignez-la : *Allowed HTTP origins / app identifiers* → votre identifiant d'application (`APP_BUNDLE_ID`).
3. Variables : `EXPO_PUBLIC_MAP_PROVIDER=maptiler`, `EXPO_PUBLIC_MAPTILER_KEY=…`.

Serveur personnel (Protomaps/OpenMapTiles compatible) : `EXPO_PUBLIC_MAP_PROVIDER=custom`, `EXPO_PUBLIC_MAP_TILES_URL=<TileJSON>`.

---

## 3. Variables de l'application

### Développement
```bash
cp apps/mobile/.env.example apps/mobile/.env
```
Renseignez `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `APP_BUNDLE_ID` (identifiant unique à vous, ex. `com.prenomnom.traque` — **définitif une fois publié**). Ce fichier est ignoré par Git.

### Builds EAS
Les variables `EXPO_PUBLIC_*` sont intégrées **au moment de la compilation**. Définissez-les sur expo.dev (étape 4.3) pour les environnements *development*, *preview* et *production*.

---

## 4. Expo / EAS (compilation des applications)

### 4.1 Compte
https://expo.dev/signup (gratuit). Dans un terminal :
```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init        # crée le projet sur expo.dev et l'identifiant EAS
```
Si `init` propose d'écrire `extra.eas.projectId`, acceptez ; sinon définissez `EAS_PROJECT_ID` (l'identifiant affiché).

### 4.2 Identifiant d'application
`APP_BUNDLE_ID` doit être identique dans `.env` et dans les variables EAS. Pour iOS il doit être unique dans l'App Store, pour Android dans Google Play.

### 4.3 Variables sur expo.dev
**expo.dev → projet → Environment variables → Add** (visibilité *Plain text*, environnements *development, preview, production*) : `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_NAME`, `APP_BUNDLE_ID` (+ variables de carte si utilisées). Ou en ligne de commande :
```bash
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://xxxx.supabase.co --environment development --environment preview --environment production --visibility plaintext
```

---

## 5. Android

Aucun compte payant n'est nécessaire pour jouer entre amis.
- **Signature** : au premier `eas build -p android`, répondez **Yes** à « Generate a new Android Keystore? » : EAS crée et conserve la clé. (Téléchargez-en une sauvegarde : `npx eas-cli credentials` → Android → *Download keystore*.)
- **Permissions** déclarées automatiquement : localisation précise/approximative, arrière-plan, service de premier plan (localisation), vibration.
- **Sur le téléphone** : autoriser l'installation d'applications de sources inconnues pour le navigateur utilisé ; dans l'application, accorder « Toujours autoriser » et **désactiver l'optimisation de batterie** pour l'application (Paramètres → Applications → Projet Traque → Batterie → *Non restreinte*), sinon certains constructeurs coupent le suivi.

## 6. iOS

⚠️ **Décision à prendre** : installer une application sur un iPhone hors App Store exige
- soit l'**Apple Developer Program (99 $/an)** → builds EAS internes (ad hoc) et TestFlight ;
- soit un **Mac** avec Xcode et un identifiant Apple gratuit → `npx expo run:ios --device` (installation valable 7 jours).

Avec le programme payant :
1. https://developer.apple.com/programs → inscription (validation 24–48 h).
2. `npx eas-cli build -p ios --profile development` → connectez-vous à Apple quand demandé ; EAS crée certificats et profils (répondez **Yes**).
3. Enregistrez les iPhone de test : `npx eas-cli device:create` (lien à ouvrir sur chaque iPhone), puis relancez le build.
4. Sur l'iPhone : **Réglages → Confidentialité et sécurité → Mode développeur → activé** (pour les builds de développement).
5. Dans l'application : autoriser la localisation, puis « Toujours » quand iOS le propose, et activer **Position exacte**.

## 7. Vérification de bout en bout
1. Compilez et installez la *development build* (DEPLOYMENT_GUIDE.md §1).
2. `npm run mobile` puis ouvrez l'application → **Commencer → Jouer en invité** → pseudo → écran des autorisations.
3. **Créer un salon** → choisir une zone → lobby avec code. ✅ Pas de message « Serveur non configuré ».

## Dépannage
| Symptôme | Solution |
|----------|----------|
| « Serveur non configuré » | variables `EXPO_PUBLIC_*` absentes **au moment du build** : corrigez `.env`/EAS puis recompilez (ou relancez `npm run mobile` en développement) |
| « Le mode invité est désactivé » | étape 1.4 |
| `Could not find the function public.report_position` | migrations non appliquées (1.3) |
| Lobby bloqué sur « Reconnexion… » | étape 1.5, migration 0600/0700 |
| Carte noire sans rues | réseau ou fournisseur de tuiles indisponible ; essayez `EXPO_PUBLIC_MAP_PROVIDER=maptiler` |
| Position « obsolète » écran éteint | autorisation « Toujours » absente ou optimisation de batterie active (5, 6) |
| Projet inaccessible après une semaine | projet gratuit en pause : tableau de bord → **Restore project** |
