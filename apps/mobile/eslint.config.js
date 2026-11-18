// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // Chargements au montage et abonnements à des systèmes externes (GPS,
      // contrôleur) : motif volontaire, signalé en avertissement.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  { ignores: ["dist/*", ".expo/*"] },
]);
