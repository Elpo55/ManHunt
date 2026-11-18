// Copie le worker MapLibre dans public/vendor/ (servi depuis notre domaine).
// Nécessaire car MapLibre 6 charge son worker à côté de son module, ce qui
// ne fonctionne pas une fois le module regroupé par le bundler.
// Lancé automatiquement avant `npm run dev` et `npm run build`.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";

const pkg = JSON.parse(readFileSync("node_modules/maplibre-gl/package.json", "utf8"));
mkdirSync("public/vendor", { recursive: true });
for (const f of readdirSync("public/vendor")) if (f.startsWith("maplibre-gl-worker-")) unlinkSync(`public/vendor/${f}`);
const target = `public/vendor/maplibre-gl-worker-${pkg.version}.mjs`;
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", target);
console.log(`worker MapLibre ${pkg.version} -> ${target}`);
