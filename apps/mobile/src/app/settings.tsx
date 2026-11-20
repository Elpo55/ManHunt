import { toAppError } from "@traque/shared";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { Guard } from "../components/Guard";
import { Button, Notice, Panel, Screen, SectionTitle, T, Toggle, useToast } from "../components/ui";
import { ROLE_LABEL, ROLE_RANK } from "../lib/api";
import { useAuth } from "../lib/auth";
import { APP_BUILD, APP_NAME, APP_VERSION, mapProvider } from "../lib/env";
import { notificationPermission, requestNotificationPermission } from "../lib/notify";
import { deleteOfflineArea, listOfflineAreas, offlineSupported, type OfflineArea } from "../lib/offline";
import { NOTIFY_LABEL, useSettings, type NotifyCategory } from "../lib/settings";
import { checkForRelease, fetchJsUpdate, reloadApp, runningUpdate } from "../lib/updates";
import { space } from "../theme";

function NotificationsPanel() {
  const [settings, update] = useSettings();
  const [perm, setPerm] = useState<"granted" | "denied" | "undetermined" | null>(null);
  useFocusEffect(
    useCallback(() => {
      notificationPermission().then(setPerm).catch(() => setPerm(null));
    }, []),
  );
  return (
    <Panel>
      <SectionTitle>Notifications</SectionTitle>
      <T v="small">
        Notifications locales affichées quand l’application est en arrière-plan ou l’écran éteint pendant une partie. Si l’application est complètement fermée, rien ne peut être reçu.
      </T>
      {perm === "denied" ? (
        <Notice tone="warn">
          <T v="small">Notifications refusées dans les réglages du téléphone.</T>
          <Button label="Ouvrir les réglages" small variant="secondary" onPress={() => void Linking.openSettings()} style={{ marginTop: space.sm }} />
        </Notice>
      ) : perm === "undetermined" ? (
        <Button label="Autoriser les notifications" small icon="bell" onPress={async () => setPerm((await requestNotificationPermission()) ? "granted" : await notificationPermission())} />
      ) : null}
      <Toggle label="Notifications de partie" value={settings.notifications} onChange={(v) => update({ notifications: v })} />
      {settings.notifications
        ? (Object.keys(NOTIFY_LABEL) as NotifyCategory[]).map((k) => (
            <Toggle
              key={k}
              label={NOTIFY_LABEL[k].label}
              description={NOTIFY_LABEL[k].description}
              value={settings.notify[k]}
              onChange={(v) => update({ notify: { ...settings.notify, [k]: v } })}
            />
          ))
        : null}
    </Panel>
  );
}

function OfflinePanel() {
  const toast = useToast();
  const [areas, setAreas] = useState<OfflineArea[] | null>(null);
  const load = useCallback(() => {
    listOfflineAreas().then(setAreas).catch(() => setAreas([]));
  }, []);
  useFocusEffect(load);
  return (
    <Panel>
      <SectionTitle>Cartes hors ligne</SectionTitle>
      <T v="small">
        {offlineSupported()
          ? "Téléchargez la carte d'une zone depuis les règles d'un salon. Hors réseau, seul le fond de carte reste consultable : le jeu (positions, captures, radar) exige une connexion."
          : `Indisponible avec le fournisseur ${mapProvider.label}.`}
      </T>
      {areas?.length === 0 ? <T v="caption">Aucune carte téléchargée.</T> : null}
      {areas?.map((a) => (
        <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <T>{a.name}</T>
            <T v="caption">{a.complete ? "Complète" : `${Math.round(a.percent)} %`} · {(a.bytes / 1048576).toFixed(1)} Mo</T>
          </View>
          <Button
            label="Supprimer"
            small
            variant="ghost"
            onPress={async () => {
              await deleteOfflineArea(a.id).catch(() => undefined);
              toast.push("Carte supprimée.", "success");
              load();
            }}
          />
        </View>
      ))}
    </Panel>
  );
}

function VersionPanel() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ota = runningUpdate();
  return (
    <Panel>
      <SectionTitle>Version</SectionTitle>
      <T>{`${APP_NAME} ${APP_VERSION} (build ${APP_BUILD})`}</T>
      <T v="caption">{ota.label}</T>
      <Button
        label="Rechercher une mise à jour"
        small
        variant="secondary"
        icon="download"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const js = await fetchJsUpdate();
            if (js === "downloaded") {
              Alert.alert("Mise à jour prête", "Un correctif a été téléchargé. Redémarrer l'application maintenant ?", [
                { text: "Plus tard", style: "cancel" },
                { text: "Redémarrer", onPress: () => void reloadApp() },
              ]);
              return;
            }
            const rel = await checkForRelease();
            if (!rel) toast.push("Vous avez la dernière version publiée.", "success");
            else
              Alert.alert(`Version ${rel.release.version} disponible`, rel.release.notes || "Nouvelle version.", [
                { text: "Fermer", style: "cancel" },
                ...(rel.release.url ? [{ text: "Télécharger", onPress: () => void Linking.openURL(rel.release.url!) }] : []),
              ]);
          } catch (e) {
            toast.push(toAppError(e).message, "error");
          } finally {
            setBusy(false);
          }
        }}
      />
    </Panel>
  );
}

export default function Settings() {
  const router = useRouter();
  const { profile } = useAuth();
  const [settings, update] = useSettings();
  const role = profile?.role ?? "player";
  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Réglages" }} />
        <Panel>
          <SectionTitle>Jeu</SectionTitle>
          <Toggle label="Vibrations" description="Captures, alertes et impulsions radar." value={settings.haptics} onChange={(v) => update({ haptics: v })} />
          <Toggle label="Garder l'écran allumé en partie" description="Recommandé si la localisation en arrière-plan est refusée." value={settings.keepAwake} onChange={(v) => update({ keepAwake: v })} />
          <Button label="Mes configurations de partie" variant="secondary" icon="folder" onPress={() => router.push("/configs")} />
        </Panel>
        <NotificationsPanel />
        <Panel>
          <SectionTitle>Localisation</SectionTitle>
          <T v="small">Votre position n’est partagée que pendant une partie active, après accord dans le salon, et s’arrête automatiquement à la fin.</T>
          <Button label="Gérer les autorisations" variant="secondary" icon="map-pin" onPress={() => router.push("/permissions")} />
        </Panel>
        <OfflinePanel />
        <Button label="Confidentialité et données" variant="ghost" icon="shield" onPress={() => router.push("/privacy")} />
        {ROLE_RANK[role] >= ROLE_RANK.moderator ? (
          <Panel>
            <SectionTitle>Administration</SectionTitle>
            <T v="small">{`Rôle : ${ROLE_LABEL[role]}. Toutes les actions sont vérifiées par le serveur et journalisées.`}</T>
            <Button label="Ouvrir le tableau de bord" icon="shield" onPress={() => router.push("/admin")} />
          </Panel>
        ) : null}
        <VersionPanel />
        <Notice>{`Carte : ${mapProvider.label}, données © OpenStreetMap contributors. ${APP_NAME} n'est pas un service d'urgence : en cas de danger, appelez le 112.`}</Notice>
      </Screen>
    </Guard>
  );
}
