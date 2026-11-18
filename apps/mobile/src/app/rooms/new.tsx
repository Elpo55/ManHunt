import { DEFAULT_CONFIG, toAppError, type GameConfig } from "@traque/shared";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ConfigForm } from "../../components/ConfigForm";
import { Guard } from "../../components/Guard";
import { Button, Field, Input, Notice, Panel, Screen, Stepper, Toggle } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export default function NewRoom() {
  const router = useRouter();
  const { profile } = useAuth();
  const [name, setName] = useState(profile?.username ? `Salon de ${profile.username}`.slice(0, 40) : "");
  const [maxPlayers, setMaxPlayers] = useState(20);
  const [allowChoice, setAllowChoice] = useState(true);
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRoom(name.trim(), config, maxPlayers, allowChoice);
      router.replace(`/room/${r.room_id}`);
    } catch (e) {
      setError(toAppError(e).message);
      setBusy(false);
    }
  }

  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Créer un salon" }} />
        <Panel>
          <Field label="Nom du salon">
            <Input value={name} onChangeText={setName} maxLength={40} />
          </Field>
          <Stepper label="Joueurs maximum" value={maxPlayers} min={2} max={20} onChange={setMaxPlayers} />
          <Toggle label="Les joueurs choisissent leur équipe" value={allowChoice} onChange={setAllowChoice} />
        </Panel>
        <ConfigForm value={config} onChange={setConfig} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button label="Créer le salon" onPress={create} loading={busy} disabled={name.trim().length < 2} />
      </Screen>
    </Guard>
  );
}
