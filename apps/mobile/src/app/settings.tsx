import { toAppError } from "@traque/shared";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Guard } from "../components/Guard";
import { Button, Notice, Panel, Screen, SectionTitle, Stat, T, Toggle, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { APP_NAME, mapProvider } from "../lib/env";
import { useSettings } from "../lib/settings";
import { space } from "../theme";

function AdminUsage() {
  const toast = useToast();
  const [u, setU] = useState<Record<string, number> | null>(null);
  const load = async () => {
    try {
      setU((await api.usageStats()) as Record<string, number>);
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    }
  };
  return (
    <Panel>
      <SectionTitle>Administration : quotas</SectionTitle>
      {u ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.lg }}>
          <Stat label="Base de données" value={`${(u.database_bytes / 1048576).toFixed(1)} Mo`} sub="limite gratuite ~500 Mo" />
          <Stat label="Messages temps réel (mois, est.)" value={u.month_delivered_estimate.toLocaleString("fr-FR")} sub="limite gratuite ~2 M" />
          <Stat label="Parties" value={u.games_total} sub={`${u.games_live} en cours`} />
          <Stat label="Profils" value={u.profiles} />
        </View>
      ) : null}
      <Button label={u ? "Actualiser" : "Charger les statistiques"} variant="secondary" small onPress={load} />
      <Button
        label="Nettoyer les anciennes données"
        variant="ghost"
        small
        onPress={async () => {
          try {
            const r = await api.adminCleanup();
            toast.push(`Nettoyage : ${r.positions_deleted ?? 0} positions, ${r.events_deleted} événements supprimés.`, "success");
          } catch (e) {
            toast.push(toAppError(e).message, "error");
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
  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Réglages" }} />
        <Panel>
          <SectionTitle>Jeu</SectionTitle>
          <Toggle label="Vibrations" description="Captures, alertes et impulsions radar." value={settings.haptics} onChange={(v) => update({ haptics: v })} />
          <Toggle label="Garder l'écran allumé en partie" description="Recommandé si la localisation en arrière-plan est refusée." value={settings.keepAwake} onChange={(v) => update({ keepAwake: v })} />
        </Panel>
        <Panel>
          <SectionTitle>Localisation</SectionTitle>
          <T v="small">Votre position n’est partagée que pendant une partie active, après accord dans le salon, et s’arrête automatiquement à la fin.</T>
          <Button label="Gérer les autorisations" variant="secondary" icon="map-pin" onPress={() => router.push("/permissions")} />
        </Panel>
        {profile?.is_admin ? <AdminUsage /> : null}
        <Notice>
          {`${APP_NAME} est un nom provisoire. Carte : ${mapProvider.label}, données © OpenStreetMap contributors.`}
        </Notice>
      </Screen>
    </Guard>
  );
}
