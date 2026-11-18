import { normalizeConfig, toAppError, type GameConfig } from "@traque/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ConfigForm } from "../../../components/ConfigForm";
import { Guard } from "../../../components/Guard";
import { Button, Loading, Notice, Screen, useToast } from "../../../components/ui";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

export default function RoomConfig() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [editable, setEditable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .roomState(id)
      .then((s) => {
        setConfig(normalizeConfig(s.room.config));
        setEditable(s.room.host_id === session?.user.id && s.room.status === "lobby");
      })
      .catch((e) => setError(toAppError(e).message));
  }, [id, session?.user.id]);

  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Règles de la partie" }} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!editable && config ? <Notice>Seul l’hôte peut modifier les règles, avant le lancement.</Notice> : null}
        {config ? <ConfigForm value={config} onChange={setConfig} disabled={!editable} /> : <Loading />}
        {editable && config ? (
          <>
            <Notice icon="info">Enregistrer les règles demande à chaque joueur de renouveler son accord (le contexte change).</Notice>
            <Button
              label="Enregistrer les règles"
              loading={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await api.updateRoomSettings(id!, { config });
                  toast.push("Règles enregistrées.", "success");
                  router.back();
                } catch (e) {
                  toast.push(toAppError(e).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </>
        ) : null}
      </Screen>
    </Guard>
  );
}
