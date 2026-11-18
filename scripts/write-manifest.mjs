// Écrit public/manifest.webmanifest avec le nom provisoire configurable
// (NEXT_PUBLIC_APP_NAME). Lancé automatiquement avant chaque build.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

for (const f of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*NEXT_PUBLIC_APP_NAME\s*=\s*(.*)\s*$/);
    if (m && !process.env.NEXT_PUBLIC_APP_NAME) process.env.NEXT_PUBLIC_APP_NAME = m[1].replace(/^["']|["']$/g, "");
  }
}
const name = (process.env.NEXT_PUBLIC_APP_NAME || "Projet Traque").trim();
const path = "public/manifest.webmanifest";
const manifest = JSON.parse(readFileSync(path, "utf8"));
manifest.name = name;
manifest.short_name = name.length > 12 ? name.split(/\s+/).pop().slice(0, 12) : name;
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest : « ${manifest.name} » (${manifest.short_name})`);
