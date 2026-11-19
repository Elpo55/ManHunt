import { DEFAULT_CONFIG, normalizeConfig, toAppError, type GameConfig } from "@traque/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ConfigForm } from "../../components/ConfigForm";
import { Guard } from "../../components/Guard";
import { SavedConfigBar } from "../../components/SavedConfigBar";
import { Button, Field, Input, Notice, Panel, Screen, Stepper, Toggle } from "../../components/ui";
import { api, savedConfigs } from "../../lib/api";
import { useAppSettings } from "../../lib/appSettings";
import { useAuth } from "../../lib/auth";

export default function NewRoom() {
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ config?: string }>();
  const settings = useAppSettings();
  const cap = settings.limits?.max_players ?? 20;
  const [name, setName] = useState(profile?.username ? `Salon de ${profile.username}`.slice(0, 40) : "");
  const [maxPlayers, setMaxPlayers] = useState(20);
  const [allowChoice, setAllowChoice] = useState(true);
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  // Valeurs par défaut globales (administration), ou configuration sauvegardée demandée.
  useEffect(() => {
    if (initialized.current) return;
    if (params.config) {
      initialized.current = true;
      savedConfigs
        .list()
        .then((l) => {
          const c = l.find((x) => x.id === params.config);
          if (c) setConfig(c.config);
        })
        .catch(() => undefined);
    } else if (settings.defaults) {
      initialized.current = true;
      const d = settings.defaults;
      // Application unique des valeurs par défaut reçues du serveur (source externe).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfig((c) => normalizeConfig({ ...c, duration_s: d.duration_s, prep_s: d.prep_s }));
      setMaxPlayers(Math.min(d.max_players, cap));
    }
  }, [params.config, settings.defaults, cap]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRoom(name.trim(), config, Math.min(maxPlayers, cap), allowChoice);
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
          <Stepper label="Joueurs maximum" value={Math.min(maxPlayers, cap)} min={2} max={cap} onChange={setMaxPlayers} />
          <Toggle label="Les joueurs choisissent leur équipe" value={allowChoice} onChange={setAllowChoice} />
        </Panel>
        <SavedConfigBar config={config} onLoad={setConfig} />
        <ConfigForm value={config} onChange={setConfig} features={settings.features} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button label="Créer le salon" onPress={create} loading={busy} disabled={name.trim().length < 2} />
      </Screen>
    </Guard>
  );
}
