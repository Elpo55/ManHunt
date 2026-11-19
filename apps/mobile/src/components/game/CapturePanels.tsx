/**
 * Capture confirmée par QR code.
 *  - Fugitif : affiche un QR temporaire (45 s, usage unique) et son code à 6 caractères.
 *  - Chasseur : scanne le QR avec la caméra, ou saisit le code si la caméra est
 *    indisponible ou refusée. Le serveur valide tout (jeton, partie, distance).
 */
import { formatClock, type CaptureToken, type GameController } from "@traque/shared";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { haptic } from "../../lib/settings";
import { colors, radius, space } from "../../theme";
import { Button, Input, Notice, T } from "../ui";
import { QrCode } from "./QrCode";

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.abyss }}>
        <View style={styles.head}>
          <T v="heading">{title}</T>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer" hitSlop={12}>
            <T color={colors.fog}>Fermer</T>
          </Pressable>
        </View>
        <View style={{ flex: 1, padding: space.lg, gap: space.lg }}>{children}</View>
      </SafeAreaView>
    </Modal>
  );
}

/** Monté à l'ouverture, démonté à la fermeture : état toujours neuf. */
export function MyCaptureCode({ controller, onClose, now }: { controller: GameController; onClose: () => void; now: number }) {
  const [token, setToken] = useState<CaptureToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const t = await controller.captureToken();
    loading.current = false;
    setToken(t ?? null);
    setError(t ? null : "Impossible d'obtenir un code (partie non en cours, ou vous n'êtes plus actif).");
  }, [controller]);
  useEffect(() => {
    void load();
  }, [load]);
  // Renouvellement automatique peu avant l'expiration.
  const expiring = !!token && token.expires_at - now < 3000;
  useEffect(() => {
    if (expiring) void load();
  }, [expiring, load]);
  return (
    <Sheet visible onClose={onClose} title="Mon code de capture">
      <T v="small">Montrez ce QR code au Chasseur qui vous a attrapé. Il change toutes les 45 secondes et ne sert qu’une fois.</T>
      <View style={{ alignItems: "center", gap: space.lg }}>
        {token ? <QrCode value={token.qr} size={260} /> : <View style={{ width: 260, height: 260, borderRadius: 12, backgroundColor: colors.slate }} />}
        <T v="caption">Sans caméra, le Chasseur saisit ce code :</T>
        <T v="numLarge" style={{ letterSpacing: 8 }}>{token?.code ?? "······"}</T>
        {token ? <T v="caption">Valable encore {formatClock(Math.max(0, token.expires_at - now))}</T> : null}
      </View>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label="Nouveau code" variant="secondary" icon="refresh-cw" onPress={() => void load()} />
    </Sheet>
  );
}

/** Monté à l'ouverture, démonté à la fermeture : état toujours neuf. */
export function ScanCapture({ controller, onClose, onCaptured }: { controller: GameController; onClose: () => void; onCaptured: () => void }) {
  const [perm, requestPerm] = useCameraPermissions();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lastScan = useRef<{ data: string; at: number } | null>(null);

  const submit = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await controller.captureByToken(value);
    setBusy(false);
    if (r && r.length) {
      haptic("success");
      onCaptured();
      onClose();
    } else setMessage("Capture refusée (code invalide, expiré, déjà utilisé ou trop loin). Les détails s'affichent en haut de l'écran.");
  };

  return (
    <Sheet visible onClose={onClose} title="Scanner un Fugitif">
      {perm?.granted ? (
        <View style={styles.camera}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(r) => {
              if (!r.data?.startsWith("manhunt:cap:")) return;
              const prev = lastScan.current;
              if (prev && prev.data === r.data && Date.now() - prev.at < 4000) return; // un seul essai par code
              lastScan.current = { data: r.data, at: Date.now() };
              void submit(r.data);
            }}
          />
        </View>
      ) : (
        <Notice icon="camera">
          <T v="small" color={colors.ivory}>
            {perm && !perm.canAskAgain
              ? "Caméra refusée. Autorisez-la dans les réglages du téléphone, ou saisissez le code ci-dessous."
              : "La caméra sert uniquement à lire le QR code du Fugitif."}
          </T>
          {perm?.canAskAgain !== false ? <Button label="Autoriser la caméra" small variant="secondary" onPress={() => void requestPerm()} style={{ marginTop: space.sm }} /> : null}
        </Notice>
      )}
      <T v="caption">Ou saisissez le code à 6 caractères affiché par le Fugitif :</T>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Input
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="K7M2QX"
          style={{ flex: 1, fontSize: 22, letterSpacing: 6, textAlign: "center" }}
        />
        <Button label="Valider" loading={busy} disabled={code.length !== 6} onPress={() => void submit(code)} />
      </View>
      {message ? <Notice tone="warn">{message}</Notice> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.md },
  camera: { height: 300, borderRadius: radius.panel, overflow: "hidden", backgroundColor: "#000" },
});
