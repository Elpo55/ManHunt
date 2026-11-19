/** Accueil : nouvelle version disponible, annonce de l'administration. */
import { useState } from "react";
import { Linking, View } from "react-native";
import { useAppSettings } from "../lib/appSettings";
import { updateSettings } from "../lib/settings";
import { useReleaseCheck } from "../lib/updates";
import { colors, space } from "../theme";
import { Button, Notice, T } from "./ui";

const SEVERITY: Record<string, string> = {
  optional: "Nouvelle version disponible",
  recommended: "Mise à jour recommandée",
  critical: "Mise à jour importante",
};

export function HomeBanners() {
  const [update, setUpdate] = useReleaseCheck();
  const settings = useAppSettings();
  const [notesOpen, setNotesOpen] = useState(false);
  const ann = settings.announcement;
  return (
    <>
      {ann?.text ? <Notice tone={ann.level === "warn" ? "warn" : "info"} icon="info">{ann.text}</Notice> : null}
      {update && !update.dismissed ? (
        <Notice tone={update.required ? "error" : "info"} icon="download">
          <T color={colors.ivory}>{`${update.required ? "Mise à jour requise" : SEVERITY[update.release.severity]} : ${update.release.version}`}</T>
          <T v="caption">{`Installée : build ${update.installedBuild} · disponible : build ${update.release.build}`}</T>
          {notesOpen && update.release.notes ? <T v="small" color={colors.ivory} style={{ marginTop: space.sm }}>{update.release.notes}</T> : null}
          <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm, flexWrap: "wrap" }}>
            {update.release.url ? (
              <Button label="Télécharger" small icon="download" onPress={() => void Linking.openURL(update.release.url!)} />
            ) : (
              <T v="caption">Demandez le fichier à l’organisateur du groupe.</T>
            )}
            {update.release.notes ? <Button label={notesOpen ? "Masquer" : "Nouveautés"} small variant="secondary" onPress={() => setNotesOpen((v) => !v)} /> : null}
            {!update.required ? (
              <Button
                label="Ignorer"
                small
                variant="ghost"
                onPress={() => {
                  updateSettings({ dismissedBuild: update.release.build });
                  setUpdate({ ...update, dismissed: true });
                }}
              />
            ) : null}
          </View>
        </Notice>
      ) : null}
    </>
  );
}
