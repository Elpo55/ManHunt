/** Charger / enregistrer les règles courantes comme configuration réutilisable. */
import { toAppError, type GameConfig } from "@traque/shared";
import { useState } from "react";
import { View } from "react-native";
import { savedConfigs } from "../lib/api";
import { space } from "../theme";
import { Button, Field, Input, Panel, T, useActionSheet, useToast } from "./ui";

export function SavedConfigBar({ config, onLoad, disabled }: { config: GameConfig; onLoad: (c: GameConfig) => void; disabled?: boolean }) {
  const toast = useToast();
  const sheet = useActionSheet();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    try {
      const list = await savedConfigs.list();
      if (!list.length) return toast.push("Aucune configuration enregistrée.");
      sheet.show({
        title: "Charger une configuration",
        message: "Remplace les règles actuelles (la zone choisie est conservée si la configuration n'en a pas).",
        actions: list.slice(0, 12).map((c) => ({
          label: c.name,
          icon: "folder" as const,
          onPress: () => {
            onLoad(c.config.zone.set ? c.config : { ...c.config, zone: config.zone });
            toast.push(`« ${c.name} » chargée.`, "success");
          },
        })),
      });
    } catch (e) {
      toast.push(toAppError(e).message, "error");
    }
  };

  return (
    <Panel>
      <T v="small">Configurations enregistrées</T>
      {saving ? (
        <>
          <Field label="Nom de la configuration">
            <Input value={name} onChangeText={setName} maxLength={40} placeholder="Ex. Parc du dimanche" />
          </Field>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Annuler" variant="ghost" style={{ flex: 1 }} onPress={() => setSaving(false)} />
            <Button
              label="Enregistrer"
              style={{ flex: 1 }}
              loading={busy}
              disabled={name.trim().length < 1}
              onPress={async () => {
                setBusy(true);
                try {
                  await savedConfigs.save(name, config);
                  toast.push("Configuration enregistrée.", "success");
                  setSaving(false);
                  setName("");
                } catch (e) {
                  toast.push(toAppError(e).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Charger" small variant="secondary" icon="folder" style={{ flex: 1 }} disabled={disabled} onPress={() => void pick()} />
          <Button label="Enregistrer ces règles" small variant="secondary" icon="save" style={{ flex: 1 }} onPress={() => setSaving(true)} />
        </View>
      )}
    </Panel>
  );
}
