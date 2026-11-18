import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Chargement de données au montage (application 100 % client / export
      // statique) : motif volontaire, signalé en avertissement seulement.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["tests/**/*.ts", "scripts/**/*.mjs"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/sw.js"]),
]);

export default eslintConfig;
