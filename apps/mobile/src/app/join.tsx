import { toAppError } from "@traque/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Guard } from "../components/Guard";
import { Button, Field, Input, Notice, Panel, Screen, T } from "../components/ui";
import { api } from "../lib/api";

const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export default function Join() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState((params.code ?? "").toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  const join = async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.joinRoom(c);
      router.replace(`/room/${r.room_id}`);
    } catch (e) {
      setError(toAppError(e).message);
      setBusy(false);
    }
  };

  // Lien d'invitation traque://join?code=XXXXXX
  useEffect(() => {
    if (!tried.current && params.code && CODE_RE.test(params.code.toUpperCase())) {
      tried.current = true;
      void join(params.code.toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  return (
    <Guard>
      <Screen>
        <Stack.Screen options={{ title: "Rejoindre" }} />
        <T v="small">Entrez le code communiqué par l’hôte.</T>
        <Panel>
          <Field label="Code du salon" hint="6 caractères, sans O, I, 0 ni 1.">
            <Input
              value={normalized}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              placeholder="K7M2QX"
              style={{ fontSize: 30, textAlign: "center", letterSpacing: 8, minHeight: 64, fontFamily: "ChakraPetch_600SemiBold" }}
            />
          </Field>
          <Button label="Rejoindre" onPress={() => join(normalized)} loading={busy} disabled={!CODE_RE.test(normalized)} />
        </Panel>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Screen>
    </Guard>
  );
}
