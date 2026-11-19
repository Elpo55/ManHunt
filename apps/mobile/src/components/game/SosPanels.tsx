/**
 * SOS : suspend immédiatement la partie et prévient tous les joueurs.
 * Manhunt n'est PAS un service d'urgence : rappel permanent d'appeler les
 * secours (112 en Europe) en cas de danger réel.
 */
import type { GameController, SosInfo } from "@traque/shared";
import { useState } from "react";
import { Linking, Modal, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, space } from "../../theme";
import { Button, Field, Input, Notice, T, Toggle } from "../ui";

const callEmergency = () => void Linking.openURL(Platform.OS === "ios" ? "telprompt:112" : "tel:112").catch(() => undefined);

export function SosRaise({ controller, visible, onClose }: { controller: GameController; visible: boolean; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <T v="title" color={colors.danger}>SOS</T>
          <T v="small" color={colors.ivory}>
            La partie sera immédiatement suspendue pour tous et chaque joueur verra votre alerte. La reprise demandera une décision de l’hôte.
          </T>
          <Notice tone="error" icon="phone">
            <T v="small" color={colors.ivory}>En cas de danger réel ou de blessure, appelez les secours : 112.</T>
          </Notice>
          <Field label="Message (facultatif)">
            <Input value={message} onChangeText={setMessage} maxLength={200} placeholder="Ex. je me suis blessé, je suis perdu…" />
          </Field>
          <Toggle
            label="Partager ma position exacte avec les joueurs de la partie"
            description="Seulement pour cette alerte, afin qu'on puisse vous rejoindre."
            value={share}
            onChange={setShare}
          />
          <Button
            label="Envoyer le SOS"
            variant="danger"
            icon="alert-octagon"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              const ok = await controller.sos(message.trim(), share);
              setBusy(false);
              if (ok) onClose();
            }}
          />
          <Button label="Appeler le 112" variant="secondary" icon="phone" onPress={callEmergency} />
          <Button label="Annuler" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** Bandeau plein écran tant qu'une alerte SOS est en cours. */
export function SosActive({
  sos,
  canResolve,
  isHost,
  controller,
  onCenter,
}: {
  sos: SosInfo;
  canResolve: boolean;
  isHost: boolean;
  controller: GameController;
  onCenter?: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <SafeAreaView style={styles.full} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <T v="title" color={colors.danger}>Alerte SOS</T>
        <T color={colors.ivory}>
          {sos.username} a déclenché une alerte. La partie est suspendue pour tout le monde.
        </T>
        {sos.message ? <Notice tone="error">« {sos.message} »</Notice> : null}
        {sos.lat != null && sos.lng != null ? (
          <Notice icon="map-pin">
            <T v="small" color={colors.ivory}>Position partagée (±{sos.acc ?? "?"} m) : visible sur la carte.</T>
            {onCenter ? <Button label="Voir sur la carte" small variant="secondary" onPress={onCenter} style={{ marginTop: space.sm }} /> : null}
          </Notice>
        ) : (
          <T v="small">Position non partagée.</T>
        )}
        <Notice tone="warn" icon="phone">
          <T v="small" color={colors.ivory}>Manhunt n’est pas un service d’urgence. En cas de danger réel, appelez le 112.</T>
        </Notice>
        <Button label="Appeler le 112" variant="danger" icon="phone" onPress={callEmergency} />
        {canResolve ? (
          <View style={{ gap: space.sm }}>
            <Field label="Note de levée (facultatif)">
              <Input value={note} onChangeText={setNote} maxLength={200} placeholder="Ex. tout le monde va bien" />
            </Field>
            <Button
              label="Lever l'alerte"
              loading={busy}
              onPress={async () => {
                setBusy(true);
                await controller.sosResolve(note.trim());
                setBusy(false);
              }}
            />
            <T v="caption">{isHost ? "Vous pourrez ensuite reprendre la partie depuis le menu." : "L'hôte décidera ensuite de reprendre la partie."}</T>
          </View>
        ) : (
          <T v="small">Seuls la personne concernée, l’hôte ou un administrateur peuvent lever l’alerte.</T>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: space.lg },
  box: { backgroundColor: colors.graphite, borderRadius: radius.panel, padding: space.lg, gap: space.md },
  full: { position: "absolute", left: 0, right: 0, top: 0, bottom: "35%", backgroundColor: "rgba(5,6,8,0.96)", zIndex: 50 },
});
