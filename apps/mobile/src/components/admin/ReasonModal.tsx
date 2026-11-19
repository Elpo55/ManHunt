/** Saisie du motif d'une action d'administration (exigé et journalisé par le serveur). */
import { useCallback, useRef, useState } from "react";
import { Modal, View } from "react-native";
import { colors, radius, space } from "../../theme";
import { Button, Field, Input, T } from "../ui";

interface Ask {
  title: string;
  message?: string;
  confirm?: string;
  destructive?: boolean;
}

/** `ask()` ouvre la fenêtre et renvoie le motif saisi, ou null si annulé. */
export function useReason() {
  const [req, setReq] = useState<Ask | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const ask = useCallback((a: Ask) => {
    setText("");
    setReq(a);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const done = (v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setReq(null);
  };

  const modal = (
    <Modal visible={!!req} transparent animationType="fade" onRequestClose={() => done(null)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: space.lg }}>
        <View style={{ backgroundColor: colors.graphite, borderRadius: radius.panel, padding: space.lg, gap: space.md }}>
          <T v="heading">{req?.title}</T>
          {req?.message ? <T v="small">{req.message}</T> : null}
          <Field label="Motif (obligatoire, journalisé)">
            <Input value={text} onChangeText={setText} maxLength={500} autoFocus />
          </Field>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Annuler" variant="ghost" style={{ flex: 1 }} onPress={() => done(null)} />
            <Button
              label={req?.confirm ?? "Valider"}
              variant={req?.destructive ? "danger" : "primary"}
              style={{ flex: 1 }}
              disabled={text.trim().length < 3}
              onPress={() => done(text.trim())}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
  return { ask, modal };
}
