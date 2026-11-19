/**
 * Autorisations GPS expliquées AVANT les invites système, et état en direct
 * (relu à chaque retour au premier plan : changement dans les réglages).
 */
import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Guard } from "../components/Guard";
import { Button, Notice, Panel, Screen, T } from "../components/ui";
import { useLocationPermissions } from "../lib/location/permissions";
import { safeNext } from "@traque/shared";
import { notificationPermission, requestNotificationPermission } from "../lib/notify";
import { colors, space } from "../theme";

function Row({ ok, title, text }: { ok: boolean | null; title: string; text: string }) {
  const icon = ok === null ? "circle" : ok ? "check-circle" : "x-circle";
  const c = ok === null ? colors.fog : ok ? colors.fugitive : colors.warn;
  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <Feather name={icon} size={20} color={c} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <T>{title}</T>
        <T v="small">{text}</T>
      </View>
    </View>
  );
}

export default function Permissions() {
  const router = useRouter();
  const next = safeNext(useLocalSearchParams<{ next?: string }>().next);
  const { state, requestForeground, requestBackground, openSettings } = useLocationPermissions();
  const fg = state.foreground === "granted";
  const bg = state.background === "granted";
  const bgLabel = Platform.OS === "ios" ? "« Toujours »" : "« Toujours autoriser »";
  const [notif, setNotif] = useState<"granted" | "denied" | "undetermined" | null>(null);
  useEffect(() => {
    notificationPermission().then(setNotif).catch(() => setNotif(null));
  }, [state]);

  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Localisation" }} />
        <T v="body">
          Le jeu utilise votre position GPS réelle, <T v="body" style={{ fontWeight: "600" }}>uniquement pendant une partie</T> et après votre accord dans le salon. Elle est
          arrondie avant d’être montrée aux autres joueurs et effacée 24 h après la partie.
        </T>
        <Panel>
          <Row ok={state.services} title="Services de localisation" text={state.services ? "Activés sur l'appareil." : "Désactivés : activez-les dans les réglages du téléphone."} />
          <Row ok={state.foreground === "unknown" ? null : fg} title="Pendant l'utilisation (obligatoire)" text="Permet de jouer l'écran allumé." />
          <Row ok={state.precise} title="Position exacte" text={state.precise ? "Précision suffisante pour les captures." : "Position approximative : les captures seront impossibles. Activez « Position exacte »."} />
          <Row
            ok={state.background === "unknown" ? null : bg}
            title={`En arrière-plan ${bgLabel} (recommandé)`}
            text="Permet de continuer la partie écran éteint. Une notification indique que le partage est actif. Sans cette autorisation, gardez l'application ouverte."
          />
        </Panel>
        {!fg ? (
          state.canAskForeground ? (
            <Button label="Autoriser pendant l'utilisation" icon="map-pin" onPress={requestForeground} />
          ) : (
            <Button label="Ouvrir les réglages" icon="settings" variant="secondary" onPress={openSettings} />
          )
        ) : !bg ? (
          state.canAskBackground ? (
            <Button label="Autoriser en arrière-plan" icon="moon" onPress={requestBackground} />
          ) : (
            <Button label="Ouvrir les réglages" icon="settings" variant="secondary" onPress={openSettings} />
          )
        ) : null}
        {!state.precise && fg ? <Button label="Activer la position exacte" variant="secondary" onPress={openSettings} /> : null}
        <Panel>
          <Row
            ok={notif === null ? null : notif === "granted"}
            title="Notifications (recommandé)"
            text="Alertes locales écran éteint pendant une partie : Chasseur proche, capture, radar, SOS. Rien n'est envoyé hors partie."
          />
          {notif === "undetermined" ? (
            <Button label="Autoriser les notifications" small variant="secondary" icon="bell" onPress={async () => setNotif((await requestNotificationPermission()) ? "granted" : await notificationPermission())} />
          ) : notif === "denied" ? (
            <Button label="Ouvrir les réglages" small variant="ghost" icon="settings" onPress={openSettings} />
          ) : null}
        </Panel>
        <Notice icon="shield">
          Vous pouvez retirer ces autorisations à tout moment dans les réglages du téléphone. Aucune position n’est envoyée hors d’une partie.
        </Notice>
        <Button label={fg ? "Continuer" : "Plus tard"} variant={fg ? "primary" : "ghost"} onPress={() => (next ? router.replace(next) : router.canGoBack() ? router.back() : router.replace("/"))} />
      </Screen>
    </Guard>
  );
}
