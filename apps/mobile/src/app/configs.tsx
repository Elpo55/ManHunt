/**
 * Configurations de partie sauvegardées (20 maximum, propres à chaque compte) :
 * enregistrer, renommer, dupliquer, supprimer, utiliser pour un nouveau salon.
 * Les données sont stockées côté serveur (table saved_game_configs, RLS).
 */
import { MODE_LABEL, formatDuration, formatMeters, toAppError } from "@traque/shared";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { Guard } from "../components/Guard";
import { Button, Field, Input, Loading, Notice, Panel, Screen, T, useActionSheet, useToast } from "../components/ui";
import { savedConfigs, type SavedConfig } from "../lib/api";
import { space } from "../theme";

export default function Configs() {
  const router = useRouter();
  const toast = useToast();
  const sheet = useActionSheet();
  const [list, setList] = useState<SavedConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedConfig | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(() => {
    savedConfigs
      .list()
      .then((l) => {
        setList(l);
        setError(null);
      })
      .catch((e) => setError(toAppError(e).message));
  }, []);
  useFocusEffect(load);

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      toast.push(ok, "success");
      load();
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    }
  };

  const menu = (c: SavedConfig) =>
    sheet.show({
      title: c.name,
      actions: [
        { label: "Créer un salon avec", icon: "plus", onPress: () => router.push(`/rooms/new?config=${c.id}`) },
        { label: "Renommer", icon: "edit-2", onPress: () => { setRenaming(c); setName(c.name); } },
        { label: "Dupliquer", icon: "copy", onPress: () => void run(() => savedConfigs.save(`${c.name} (copie)`.slice(0, 40), c.config), "Configuration dupliquée.") },
        {
          label: "Supprimer",
          icon: "trash-2",
          tone: "destructive",
          onPress: () =>
            Alert.alert("Supprimer ?", `« ${c.name} » sera supprimée définitivement.`, [
              { text: "Annuler", style: "cancel" },
              { text: "Supprimer", style: "destructive", onPress: () => void run(() => savedConfigs.remove(c.id), "Configuration supprimée.") },
            ]),
        },
      ],
    });

  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Mes configurations" }} />
        <T v="small">Enregistrez les règles d’un salon (bouton « Enregistrer ces règles » à la création ou dans les règles du salon) pour les réutiliser.</T>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {list === null && !error ? <Loading /> : null}
        {list && list.length === 0 ? <T v="small">Aucune configuration enregistrée.</T> : null}
        {renaming ? (
          <Panel>
            <Field label="Nouveau nom">
              <Input value={name} onChangeText={setName} maxLength={40} />
            </Field>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button label="Annuler" variant="ghost" style={{ flex: 1 }} onPress={() => setRenaming(null)} />
              <Button
                label="Renommer"
                style={{ flex: 1 }}
                disabled={name.trim().length < 1}
                onPress={() => {
                  const c = renaming;
                  setRenaming(null);
                  void run(() => savedConfigs.save(name, c.config, c.id), "Configuration renommée.");
                }}
              />
            </View>
          </Panel>
        ) : null}
        {list?.map((c) => (
          <Panel key={c.id}>
            <T v="heading">{c.name}</T>
            <T v="small">
              {MODE_LABEL[c.config.mode]} · {formatDuration(c.config.duration_s)} · {c.config.zone.set ? `${c.config.zone.label}, ${formatMeters(c.config.zone.radius_m)}` : "zone non choisie"}
            </T>
            <Button label="Options" small variant="secondary" icon="more-horizontal" onPress={() => menu(c)} />
          </Panel>
        ))}
      </Screen>
    </Guard>
  );
}
