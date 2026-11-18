# Guide de compilation et de distribution

L'application se compile avec **EAS Build** (cloud Expo, offre gratuite) ou localement. Le backend Supabase doit être configuré avant (SETUP_GUIDE.md).

Profils (`apps/mobile/eas.json`) :
| Profil | Usage | Android | iOS |
|--------|-------|---------|-----|
| `development` | développement avec rechargement instantané | APK | appareils enregistrés (compte Apple payant) |
| `preview` | version de test autonome à distribuer à vos amis | APK | ad hoc (compte Apple payant) |
| `production` | stores | AAB (Play Store) | App Store / TestFlight |

---

## 1. Development build (développement)

```bash
cd apps/mobile
npx eas-cli build --profile development --platform android
```
À la fin, EAS affiche un lien et un QR code : ouvrez-le sur le téléphone Android pour installer l'APK. Puis, sur l'ordinateur :
```bash
npm run start          # depuis apps/mobile ; ou « npm run mobile » à la racine
```
Ouvrez l'application installée : elle se connecte au serveur de développement (même Wi-Fi, ou `npx expo start --dev-client --tunnel`).

Alternative locale Android (sans EAS) : Android Studio + SDK + NDK installés, téléphone en débogage USB, puis `npx expo run:android`. (Ce PC possède déjà le SDK Android ; le NDK et un émulateur restent à installer — plusieurs Go.)

## 2. Version de test pour vos amis (preview)

```bash
npx eas-cli build --profile preview --platform android
```
Partagez le lien de téléchargement de l'APK (page du build sur expo.dev → **Install**). Chaque ami autorise l'installation depuis son navigateur.

iOS (compte Apple payant) : enregistrez chaque iPhone (`npx eas-cli device:create`), puis `npx eas-cli build --profile preview --platform ios` et partagez le lien.

## 3. Mettre à jour l'application

- **Code JavaScript seulement** (écrans, logique) : recompiler le profil voulu, ou mettre en place EAS Update plus tard (`npx expo install expo-updates`, non configuré à ce stade).
- **Changement natif** (nouvelle permission, nouveau module, `app.config.ts`) : nouveau build obligatoire.
- **Base de données** : nouvelle migration dans `supabase/migrations/` puis `npx supabase db push`, **avant** de distribuer l'application qui en dépend.
- Versions : `version` dans `app.config.ts` ; les numéros de build sont incrémentés par EAS (`appVersionSource: remote`).

## 4. Revenir en arrière

- **Application** : réinstallez un APK précédent depuis l'historique des builds sur expo.dev (Android) ; sur iOS, réinstallez un build précédent (ad hoc) ou une ancienne version TestFlight.
- **Code** : `git revert <commit>` puis recompilation.
- **Base** : écrire une migration corrective (les migrations ne s'annulent pas automatiquement). Sauvegarde ponctuelle : `npx supabase db dump -f sauvegarde.sql`.
- **Version web historique** : `git checkout v0.1.0-web`.

## 5. Publication sur les stores (facultatif)

### Google Play (25 $ une fois)
1. https://play.google.com/console → création du compte développeur (vérification d'identité).
2. `npx eas-cli build --profile production --platform android` (AAB).
3. Console : créer l'application, fiche, **Contenu de l'application → Règles de confidentialité** (URL d'une politique décrivant le partage de position), **Déclaration des autorisations de localisation en arrière-plan** (justification + vidéo montrant la fonctionnalité et la notification), **Sécurité des données** (localisation précise collectée, partagée avec d'autres utilisateurs, chiffrée en transit, supprimable).
4. `npx eas-cli submit -p android` ou envoi manuel ; piste **Test interne** d'abord.

### App Store (Apple Developer Program, 99 $/an)
1. `npx eas-cli build --profile production --platform ios`, puis `npx eas-cli submit -p ios` (TestFlight).
2. App Store Connect : fiche, **Confidentialité de l'app** (localisation précise, liée à l'utilisateur, non utilisée pour le suivi publicitaire), politique de confidentialité, justification de la localisation en arrière-plan pour la revue.
3. Les textes des autorisations sont déjà rédigés dans `app.config.ts`.

Une **politique de confidentialité** publique est exigée par les deux stores : elle peut reprendre docs/SECURITY.md (sections « Données de localisation » et « Rétention »).
