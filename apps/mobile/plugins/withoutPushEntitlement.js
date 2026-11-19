/**
 * Plugin de configuration Expo : retire l'autorisation « Push Notifications »
 * (aps-environment) ajoutée par expo-notifications sur iOS.
 *
 * Pourquoi : Manhunt n'utilise QUE des notifications locales. Or un compte
 * Apple gratuit (« Personal Team ») ne peut pas signer une application qui
 * déclare les notifications push : la compilation Xcode échouerait.
 * Les notifications locales fonctionnent sans cette autorisation.
 */
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"];
    return cfg;
  });
};
