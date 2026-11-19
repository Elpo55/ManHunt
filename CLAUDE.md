# Instructions du projet — Projet Traque

Jeu de traque géolocalisé multijoueur (Expo / React Native Android + iOS, Supabase).
Monorepo npm : `apps/mobile` (application), `packages/shared` (logique testée, sans React),
`supabase/migrations` (serveur : RLS, RPC, moteur de partie), `tests/` (Vitest + PGlite).

## Commandes
- `npm test` — tous les tests (unitaires + base de données réelle PGlite avec les migrations)
- `npm run typecheck` · `npm run lint`
- `npm run release:apk` — livraison Android (voir ci-dessous) ; `-- --install` pour installer via adb
- Supabase (projet lié) : `npx supabase db push --remote --yes` applique les nouvelles migrations

## Règles permanentes

### Livraison : un APK à CHAQUE version finalisée (obligatoire)
Toute nouvelle version finalisée entraîne, sans qu'on ait à le redemander :
1. Version mise à jour dans `apps/mobile/package.json` (source unique ; `package.json` racine et
   `packages/shared/package.json` alignés). Versionnement sémantique : MAJEUR = incompatible,
   MINEUR = fonctionnalité, CORRECTIF = correction. Regrouper les changements cohérents ; ne pas
   changer la version pour une modification interne isolée.
2. Numéro de build dérivé automatiquement (`MAJEUR*10000 + MINEUR*100 + CORRECTIF`, cf. `app.config.ts`).
3. Section `## [X.Y.Z] — date` ajoutée en tête de `CHANGELOG.md` (le script l'extrait).
4. Commit des changements, migrations éventuelles appliquées au projet Supabase.
5. `npm run release:apk` : typage, lint, tests, `expo prebuild --clean`, `assembleRelease`
   (arm64-v8a + armeabi-v7a), contrôles (aapt : version/build/identifiant ; apksigner ; URL
   Supabase intégrée ; aucun secret), puis `releases/vX.Y.Z/` :
   `application-vX.Y.Z.apk`, `CHANGELOG.md`, `BUILD_REPORT.md`.
6. Jamais écraser un APK déjà livré (le script refuse) ; les APK ne sont pas versionnés dans Git
   (`releases/**/*.apk` ignoré), leurs CHANGELOG/BUILD_REPORT le sont.
7. Livrable annoncé à l'utilisateur : version, nouveautés, bugs corrigés, tests effectués / non
   effectués, état de compilation, chemin exact de l'APK, procédure d'installation.

### Signature
- Par défaut l'APK est signé avec la clé de DÉBOGAGE publique (test uniquement) : le dire clairement.
- Clé personnelle : variables `TRAQUE_KEYSTORE` (fichier HORS dépôt), `TRAQUE_KEYSTORE_PASSWORD`,
  `TRAQUE_KEY_ALIAS`, `TRAQUE_KEY_PASSWORD`. Ne jamais générer une clé destinée à devenir
  définitive à la place de l'utilisateur ; ne jamais commiter de keystore, mot de passe ou `.env`.

### Honnêteté des tests
- Ne jamais prétendre avoir testé sur téléphone, en multijoueur réel ou sur iOS si ce n'est pas le cas.
  Les tests automatisés (PGlite + unitaires) et le build ne remplacent pas un test terrain.

### iOS
- Chaque évolution doit rester compatible iOS (permissions `infoPlist`, GPS arrière-plan, MapLibre).
  Pas de compilation iOS possible depuis Windows : documenter les étapes macOS/EAS (DEPLOYMENT_GUIDE.md).

### Code
- Le client ne modifie jamais l'état du jeu directement : tout passe par des RPC serveur.
- Positions : privées côté serveur, arrondies avant diffusion, effacées 24 h après la partie.
- Android `Alert.alert` : 3 boutons maximum → utiliser `useActionSheet()` pour les menus.
- Windows : le build natif se fait dans le worktree `C:/tqb` avec CMake ≥ 3.30 / ninja ≥ 1.12 (limite de 260 caractères) — géré par le script.
