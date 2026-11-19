import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Button, Field, Input, Notice, Panel, Screen, Segmented, T } from "../components/ui";
import { useAuth } from "../lib/auth";
import { safeNext, withNext } from "@traque/shared";

export default function Login() {
  const { session, profile, profileError, signInGuest, signInEmail, signUpEmail } = useAuth();
  const router = useRouter();
  const next = safeNext(useLocalSearchParams<{ next?: string }>().next);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"guest" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (session && profile) router.replace(profile.username ? (next ?? "/") : withNext("/onboarding", next));
  }, [session, profile, router, next]);

  const run = async (kind: "guest" | "email", fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: "Connexion" }} />
      <T v="small">Le mode invité suffit pour jouer. Un compte conserve vos statistiques sur tous vos appareils.</T>
      <Panel>
        <Button label="Jouer en invité" onPress={() => run("guest", signInGuest)} loading={busy === "guest"} disabled={!!busy} />
        <T v="small">Aucune adresse demandée. Vous pourrez lier un e-mail plus tard.</T>
      </Panel>
      <Panel>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "signin", label: "J'ai un compte" },
            { value: "signup", label: "Créer un compte" },
          ]}
        />
        <Field label="E-mail">
          <Input value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        </Field>
        <Field label="Mot de passe" hint={mode === "signup" ? "8 caractères minimum." : undefined}>
          <Input value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "signin" ? "current-password" : "new-password"} />
        </Field>
        <Button
          label={mode === "signin" ? "Se connecter" : "Créer le compte"}
          variant="secondary"
          loading={busy === "email"}
          disabled={!!busy || !email.includes("@") || password.length < 8}
          onPress={() =>
            run("email", async () => {
              if (mode === "signin") await signInEmail(email.trim(), password);
              else {
                const r = await signUpEmail(email.trim(), password);
                if (r.needsConfirmation) setInfo("Compte créé : confirmez votre adresse via le lien reçu par e-mail, puis connectez-vous.");
              }
            })
          }
        />
      </Panel>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {session && !profile && profileError ? <Notice tone="error">{profileError.message}</Notice> : null}
      {info ? <Notice>{info}</Notice> : null}
    </Screen>
  );
}
