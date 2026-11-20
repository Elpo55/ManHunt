/** Saisie du code à 6 chiffres reçu par e-mail, avec renvoi (délai de 60 s). */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { colors, space } from "../theme";
import { Button, Field, Input, Notice, T } from "./ui";

export function EmailCodeForm({
  email,
  onVerify,
  onResend,
  submitLabel = "Valider le code",
}: {
  email: string;
  onVerify: (code: string) => Promise<void>;
  onResend?: () => Promise<void>;
  submitLabel?: string;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(60);

  useEffect(() => {
    if (wait <= 0) return;
    const h = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(h);
  }, [wait]);

  return (
    <View style={{ gap: space.md }}>
      <T v="small" color={colors.ivory}>{`Un code à 6 chiffres a été envoyé à ${email}. Il est valable 15 minutes (pensez à regarder dans les spams).`}</T>
      <Field label="Code reçu par e-mail">
        <Input
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          placeholder="123456"
          style={{ fontSize: 28, letterSpacing: 10, textAlign: "center", minHeight: 60 }}
          accessibilityLabel="Code à 6 chiffres"
        />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? <Notice>{info}</Notice> : null}
      <Button
        label={submitLabel}
        loading={busy}
        disabled={code.length !== 6}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await onVerify(code);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {onResend ? (
        <Button
          label={wait > 0 ? `Renvoyer un code (${wait} s)` : "Renvoyer un code"}
          small
          variant="ghost"
          disabled={wait > 0}
          onPress={async () => {
            setError(null);
            try {
              await onResend();
              setInfo("Nouveau code envoyé.");
              setWait(60);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      ) : null}
    </View>
  );
}
