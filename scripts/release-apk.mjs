#!/usr/bin/env node
/**
 * Livraison d'une version Android : vérifications -> APK release -> contrôles
 * -> dossier releases/vX.Y.Z/ (APK + CHANGELOG + BUILD_REPORT).
 *
 * Usage (racine du dépôt) :
 *   npm run release:apk                 # build complet
 *   npm run release:apk -- --install    # + installation sur le téléphone branché (adb)
 *   npm run release:apk -- --skip-checks  # (déconseillé) sans typage/tests/lint
 *
 * Signature :
 *   - Par défaut : clé de DÉBOGAGE publique du modèle React Native. APK
 *     installable pour TESTER, jamais publiable (Play Store refuse) ; le
 *     rapport l'indique clairement.
 *   - Clé personnelle : définir les variables d'environnement
 *       TRAQUE_KEYSTORE        chemin absolu du .jks (HORS dépôt)
 *       TRAQUE_KEYSTORE_PASSWORD, TRAQUE_KEY_ALIAS, TRAQUE_KEY_PASSWORD
 *     (voir DEPLOYMENT_GUIDE.md §APK). Les mots de passe ne sont jamais écrits
 *     sur disque ni dans le rapport.
 *
 * Le build se fait dans un worktree Git du commit courant à un chemin court
 * (C:\tqb sous Windows, modifiable via TRAQUE_BUILD_DIR) : APK = commit exact,
 * et pas de dépassement de la limite de 260 caractères de CMake/ninja.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE = join(ROOT, "apps", "mobile");
const args = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";
const ABIS = "arm64-v8a,armeabi-v7a";
const t0 = Date.now();
const log = (m) => console.log(`\n▶ ${m}`);
const fail = (m) => {
  console.error(`\n✖ ${m}`);
  cleanup();
  process.exit(1);
};

// ---------------------------------------------------------------- version
const version = JSON.parse(readFileSync(join(MOBILE, "package.json"), "utf8")).version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!m) fail(`Version invalide dans apps/mobile/package.json : ${version}`);
const build = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
const outDir = join(ROOT, "releases", `v${version}`);
const apkOut = join(outDir, `application-v${version}.apk`);
if (existsSync(apkOut)) fail(`${apkOut} existe déjà. Un APK livré n'est jamais remplacé : augmentez la version (apps/mobile/package.json).`);

// ---------------------------------------------------------------- outils
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk || !existsSync(sdk)) fail("ANDROID_HOME introuvable (SDK Android requis).");
const buildTools = readdirSync(join(sdk, "build-tools")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const bt = (tool) => join(sdk, "build-tools", buildTools, isWin ? (tool === "apksigner" ? "apksigner.bat" : `${tool}.exe`) : tool);
const sh = (cmd, cmdArgs, opts = {}) => {
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: isWin, ...opts });
  return r.status === 0;
};
const out = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { encoding: "utf8", shell: isWin, ...opts });

// ---------------------------------------------------------------- configuration publique
const env = existsSync(join(MOBILE, ".env")) ? readFileSync(join(MOBILE, ".env"), "utf8") : "";
const envVal = (k) => process.env[k] ?? new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1]?.trim();
const supaUrl = envVal("EXPO_PUBLIC_SUPABASE_URL");
if (!supaUrl || !/^https:\/\//.test(supaUrl) || !(envVal("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? "").length)
  fail("apps/mobile/.env : EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY manquants (l'application afficherait « Serveur non configuré »).");
const bundleId = envVal("APP_BUNDLE_ID") || "com.example.projettraque";

// ---------------------------------------------------------------- vérifications
const checks = [];
if (!args.has("--skip-checks")) {
  for (const [name, script] of [["Typage", "typecheck"], ["Lint", "lint"], ["Tests automatisés", "test"]]) {
    log(name);
    const ok = sh("npm", ["run", script], { cwd: ROOT });
    checks.push({ name, ok });
    if (!ok) fail(`${name} en échec : build annulé.`);
  }
} else checks.push({ name: "Vérifications", ok: null });

// ---------------------------------------------------------------- copie de build (commit exact, chemin court)
// L'APK est compilé depuis un worktree Git du commit courant, à un chemin court :
//  - reproductible : l'APK correspond exactement à un commit (sources non commitées refusées) ;
//  - Windows : la compilation C++ (CMake/ninja) échoue au-delà de 260 caractères depuis
//    un chemin long ; un lecteur « subst » ne suffit pas (l'autolinking Expo résout le
//    vrai chemin et mélange les deux racines).
function cleanup() {}
const gitIn = (cwd, a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const pending = gitIn(ROOT, ["status", "--porcelain", "--", "apps", "packages", "package.json", "package-lock.json"]);
if (pending) fail(`Modifications non commitées dans le code de l'application :
${pending}
Commitez-les d'abord : l'APK doit correspondre à un commit.`);
const commitSha = gitIn(ROOT, ["rev-parse", "HEAD"]);
const root = process.env.TRAQUE_BUILD_DIR || (isWin ? "C:/tqb" : join(ROOT, ".build-worktree"));
log(`Copie de build : ${root} (commit ${commitSha.slice(0, 7)})`);
if (!existsSync(join(root, ".git"))) {
  if (existsSync(root) && readdirSync(root).length) fail(`${root} existe et n'est pas un worktree du dépôt.`);
  gitIn(ROOT, ["worktree", "prune"]);
  gitIn(ROOT, ["worktree", "add", "--detach", root, commitSha]);
} else {
  gitIn(root, ["checkout", "--detach", "--force", commitSha]);
  // Fichiers générés supprimés (dont android/), dépendances conservées.
  gitIn(root, ["clean", "-fdx", "-e", "node_modules", "-e", ".lock-hash"]);
}
const lockHash = createHash("sha256").update(readFileSync(join(root, "package-lock.json"))).digest("hex");
const lockMark = join(root, ".lock-hash");
if (!existsSync(lockMark) || readFileSync(lockMark, "utf8") !== lockHash) {
  log("Installation des dépendances (npm ci)");
  if (!sh("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root })) fail("npm ci a échoué dans la copie de build.");
  writeFileSync(lockMark, lockHash);
}
// Configuration publique (jamais de secret) : .env local copié dans la copie de build.
copyFileSync(join(MOBILE, ".env"), join(root, "apps", "mobile", ".env"));
const mobile = join(root, "apps", "mobile");
const android = join(mobile, "android");

// ---------------------------------------------------------------- génération native
log("Génération du projet Android (expo prebuild --clean)");
if (!sh("npx", ["--no-install", "expo", "prebuild", "--platform", "android", "--clean", "--no-install"], { cwd: mobile, env: { ...process.env, CI: "1" } }))
  fail("expo prebuild a échoué.");

const gradleFile = join(android, "app", "build.gradle");
const ks = process.env.TRAQUE_KEYSTORE;
let signing = "debug";
if (ks) {
  for (const k of ["TRAQUE_KEYSTORE_PASSWORD", "TRAQUE_KEY_ALIAS", "TRAQUE_KEY_PASSWORD"]) if (!process.env[k]) fail(`${k} manquant (signature personnelle).`);
  if (!existsSync(ks)) fail(`Keystore introuvable : ${ks}`);
  if (resolve(ks).toLowerCase().startsWith(ROOT.toLowerCase())) fail("Le keystore doit être stocké HORS du dépôt.");
  let g = readFileSync(gradleFile, "utf8");
  // Mots de passe lus dans l'environnement au moment du build : rien n'est écrit sur disque.
  g = g.replace(
    /signingConfigs \{\n/,
    `signingConfigs {\n        release {\n            storeFile file(System.getenv("TRAQUE_KEYSTORE"))\n            storePassword System.getenv("TRAQUE_KEYSTORE_PASSWORD")\n            keyAlias System.getenv("TRAQUE_KEY_ALIAS")\n            keyPassword System.getenv("TRAQUE_KEY_PASSWORD")\n        }\n`,
  );
  g = g.replace(/(release \{\n\s*\/\/ Caution![^\n]*\n[^\n]*\n\s*)signingConfig signingConfigs\.debug/, "$1signingConfig signingConfigs.release");
  if (!g.includes("signingConfig signingConfigs.release")) fail("Impossible d'injecter la signature personnelle dans build.gradle.");
  writeFileSync(gradleFile, g);
  signing = "personal";
}

// ---------------------------------------------------------------- compilation
log(`Compilation de l'APK release (${ABIS})`);
// Chemin absolu : sous Windows, le répertoire courant peut être exclu de la recherche
// des exécutables (NoDefaultCurrentDirectoryInExePath).
const gradlew = join(android, isWin ? "gradlew.bat" : "gradlew");
const gradleOk = sh(gradlew, ["assembleRelease", `-PreactNativeArchitectures=${ABIS}`, "--no-daemon"], {
  cwd: android,
  env: { ...process.env, NODE_ENV: "production", CI: "1" },
});
if (!gradleOk) fail("La compilation Gradle a échoué (voir ci-dessus).");
const apkDir = join(android, "app", "build", "outputs", "apk", "release");
const built = existsSync(apkDir) ? readdirSync(apkDir).filter((f) => f.endsWith(".apk")) : [];
if (built.length !== 1) fail(`APK attendu introuvable dans ${apkDir}.`);
const apkBuilt = join(apkDir, built[0]);

// ---------------------------------------------------------------- contrôles de l'APK
log("Contrôle de l'APK");
const badging = out(bt("aapt"), ["dump", "badging", apkBuilt]);
const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
if (!pkg) fail("aapt n'a pas pu lire l'APK.");
const [, apkPkg, apkCode, apkName] = pkg;
if (apkName !== version) fail(`versionName ${apkName} ≠ ${version}`);
if (Number(apkCode) !== build) fail(`versionCode ${apkCode} ≠ ${build}`);
if (apkPkg !== bundleId) fail(`Identifiant ${apkPkg} ≠ APP_BUNDLE_ID ${bundleId}`);
const minSdk = /sdkVersion:'(\d+)'/.exec(badging)?.[1];
const targetSdk = /targetSdkVersion:'(\d+)'/.exec(badging)?.[1];
const abis = /native-code: (.*)/.exec(badging)?.[1]?.replaceAll("'", "") ?? "?";
const perms = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map((x) => x[1].replace("android.permission.", ""));

const verify = spawnSync(bt("apksigner"), ["verify", "--verbose", "--print-certs", apkBuilt], { encoding: "utf8", shell: isWin });
if (verify.status !== 0) fail(`Signature invalide :\n${verify.stdout}${verify.stderr}`);
const certDn = /Signer #1 certificate DN: (.*)/.exec(verify.stdout)?.[1] ?? "?";
const certSha = /Signer #1 certificate SHA-256 digest: (\w+)/.exec(verify.stdout)?.[1] ?? "?";
const schemes = [...verify.stdout.matchAll(/Verified using (v[\d.]+) scheme[^:]*: true/g)].map((x) => x[1]).join(", ");

// Bundle JavaScript : configuration publique présente, aucun secret.
const listing = out(bt("aapt"), ["list", apkBuilt]);
if (!listing.includes("assets/index.android.bundle")) fail("Bundle JavaScript absent de l'APK (build de développement ?).");
const unzip = spawnSync("tar", ["-xOf", apkBuilt, "assets/index.android.bundle"], { maxBuffer: 256 * 1024 * 1024 });
const bundle = unzip.status === 0 ? unzip.stdout.toString("latin1") : "";
const bundleHasUrl = bundle.includes(new URL(supaUrl).host);
const bundleSecret = /sb_secret_|service_role/.test(bundle);
if (bundle && !bundleHasUrl) fail("L'URL Supabase n'est pas intégrée au bundle : l'application afficherait « Serveur non configuré ».");
if (bundleSecret) fail("Une clé secrète Supabase semble présente dans le bundle : livraison refusée.");
const devClient = listing.includes("expo-dev-launcher") || bundle.includes("DevLauncher");

// ---------------------------------------------------------------- livraison
mkdirSync(outDir, { recursive: true });
copyFileSync(apkBuilt, apkOut);
const sha256 = createHash("sha256").update(readFileSync(apkOut)).digest("hex");
const sizeMb = (statSync(apkOut).size / 1048576).toFixed(1);

const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const sec = new RegExp(`^## \\[?${version.replaceAll(".", "\\.")}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m").exec(changelog);
if (!sec) fail(`Section « ## ${version} » absente de CHANGELOG.md.`);
writeFileSync(join(outDir, "CHANGELOG.md"), `# Projet Traque — v${version} (build ${build})\n\n${sec[0].split("\n").slice(1).join("\n").trim()}\n`);

let install = "non demandée (`--install`)";
if (args.has("--install")) {
  const devices = out("adb", ["devices"]).split("\n").slice(1).filter((l) => /\tdevice$/.test(l.trim()) || /\tdevice/.test(l));
  if (!devices.length) install = "demandée, mais aucun téléphone connecté (adb devices vide)";
  else {
    const r = spawnSync("adb", ["install", "-r", apkOut], { encoding: "utf8", shell: isWin });
    install = r.status === 0 ? `réussie sur ${devices.length} appareil(s) (adb install -r)` : `ÉCHEC : ${(r.stdout + r.stderr).trim()}`;
  }
}

const git = (a) => {
  try {
    return out("git", a, { cwd: ROOT }).trim();
  } catch {
    return "?";
  }
};
const commit = commitSha.slice(0, 7);
const dirty = false; // garanti : sources de l'application commitées (vérifié avant le build)
const jdk = (spawnSync("java", ["-version"], { encoding: "utf8", shell: isWin, env: process.env }).stderr || "").split("\n")[0].trim();
const expoSdk = JSON.parse(readFileSync(join(ROOT, "node_modules", "expo", "package.json"), "utf8")).version;
const rn = JSON.parse(readFileSync(join(ROOT, "node_modules", "react-native", "package.json"), "utf8")).version;
const mins = ((Date.now() - t0) / 60000).toFixed(1);
const mark = (ok) => (ok === null ? "⏭️ ignoré" : ok ? "✅" : "❌");

writeFileSync(
  join(outDir, "BUILD_REPORT.md"),
  `# Rapport de build — v${version} (build ${build})

| | |
|---|---|
| Date | ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC |
| Fichier | \`releases/v${version}/application-v${version}.apk\` (${sizeMb} Mo) |
| SHA-256 | \`${sha256}\` |
| Type | **APK release** (bundle JavaScript intégré, sans serveur de développement)${devClient ? " — ⚠️ contient le client de développement" : ""} |
| Identifiant | \`${apkPkg}\` |
| versionName / versionCode | ${apkName} / ${apkCode} ✅ conformes à apps/mobile/package.json |
| Android | minSdk ${minSdk} · targetSdk ${targetSdk} |
| Architectures | ${abis} |
| Signature | ${signing === "debug" ? "⚠️ **clé de DÉBOGAGE** (modèle React Native) — test uniquement, non publiable" : "clé personnelle (TRAQUE_KEYSTORE)"} |
| Certificat | ${certDn} · SHA-256 \`${certSha}\` · schémas ${schemes || "?"} |
| Commit | \`${commit}\`${dirty ? " + modifications non commitées" : ""} |
| Outils | Expo SDK ${expoSdk} · React Native ${rn} · ${jdk} · build-tools ${buildTools} |
| Durée | ${mins} min |

## Vérifications
${checks.map((c) => `- ${mark(c.ok)} ${c.name}`).join("\n")}
- ✅ Compilation Gradle \`assembleRelease\` terminée sans erreur
- ✅ APK présent, lisible par \`aapt\`, version et identifiant conformes
- ✅ Signature vérifiée par \`apksigner verify\`
- ${bundle ? (bundleHasUrl ? "✅" : "❌") : "⚠️"} Configuration Supabase publique intégrée au bundle${bundle ? "" : " (non vérifiable : extraction impossible)"}
- ✅ Aucune clé secrète Supabase (\`sb_secret_\`, \`service_role\`) dans le bundle
- Installation sur téléphone : ${install}

## Permissions déclarées
${perms.map((p) => `\`${p}\``).join(", ")}

## Installation
1. Copier \`application-v${version}.apk\` sur le téléphone (câble, Drive, e-mail…), ou \`adb install -r releases/v${version}/application-v${version}.apk\`.
2. Ouvrir le fichier, autoriser « Installer des applications inconnues » pour l'application utilisée.
3. Une version précédente **signée avec la même clé** est mise à jour en conservant la session. Si Android refuse (« conflit de signature »), désinstaller l'ancienne version d'abord.
`,
);

cleanup();
console.log(`\n✔ v${version} (build ${build}) livrée en ${mins} min\n  ${apkOut}\n  SHA-256 ${sha256}`);
