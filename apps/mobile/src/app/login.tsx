/**
 * Connexion. Invité (sans e-mail) ou compte e-mail :
 *  - création : e-mail + mot de passe, puis code à 6 chiffres reçu par e-mail
 *    (prouve que l'adresse appartient bien à l'utilisateur) ;
 *  - connexion : e-mail + mot de passe ; si l'adresse n'a jamais été confirmée,
 *    saisie du code ;
 *  - mot de passe oublié : code reçu par e-mail puis nouveau mot de passe.
 */
import { safeNext, withNext } from "@traque/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { EmailCodeForm } from "../components/EmailCodeForm";
import { Button, Field, Input, Notice, Panel, Screen, Segmented, T } from "../components/ui";
import { useAuth } from "../lib/auth";

type Step = "form" | "code" | "forgot" | "reset" | "newPassword";

export default function Login() {
  const { session, profile, profileError, signInGuest, signInEmail, signUpEmail, verifyEmailCode, resendEmailCode, requestPasswordReset, setNewPassword } = useAuth();
  const router = useRouter();
  const next = safeNext(useLocalSearchParams<{ next?: string }>().next);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"guest" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Réinitialisation en cours : la session ouverte par le code ne doit pas rediriger avant le nouveau mot de passe.
  const resetting = useRef(false);

  // Une fois connecté (et le mot de passe redéfini si besoin), on continue.
  useEffect(() => {
    if (session && profile && !resetting.current) router.replace(profile.username ? (next ?? "/") : withNext("/onboarding", next));
  }, [session, profile, router, next, step]);

  const run = async (kind: "guest" | "email", fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      const err = e as { code?: string; message: string };
      if (err.code === "E_EMAIL_NOT_CONFIRMED") {
        // Compte créé mais jamais confirmé : on renvoie un code et on le demande.
        await resendEmailCode(email.trim(), "signup").catch(() => undefined);
        setStep("code");
      } else setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const addr = email.trim();

  return (
    <Screen>
      <Stack.Screen options={{ title: "Connexion" }} />

      {step === "form" ? (
        <>
          <T v="small">Le mode invité suffit pour jouer. Un compte e-mail conserve vos statistiques sur tous vos appareils.</T>
          <Panel>
            <Button label="Jouer en invité" onPress={() => run("guest", signInGuest)} loading={busy === "guest"} disabled={!!busy} />
            <T v="small">Aucune adresse demandée. Vous pourrez lier un e-mail plus tard.</T>
          </Panel>
          <Panel>
            <Segmented
              value={mode}
              onChange={(v) => {
                setMode(v);
                setError(null);
              }}
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
            {mode === "signup" ? <T v="caption">Un code à 6 chiffres vous sera envoyé par e-mail pour confirmer que l’adresse vous appartient.</T> : null}
            <Button
              label={mode === "signin" ? "Se connecter" : "Créer le compte"}
              variant="secondary"
              loading={busy === "email"}
              disabled={!!busy || !addr.includes("@") || password.length < 8}
              onPress={() =>
                run("email", async () => {
                  if (mode === "signin") await signInEmail(addr, password);
                  else {
                    const r = await signUpEmail(addr, password);
                    if (r.needsConfirmation) setStep("code");
                  }
                })
              }
            />
            {mode === "signin" ? (
              <Button
                label="Mot de passe oublié ?"
                small
                variant="ghost"
                onPress={() => {
                  setError(null);
                  setStep("forgot");
                }}
              />
            ) : null}
          </Panel>
        </>
      ) : null}

      {step === "code" ? (
        <Panel>
          <T v="heading">Confirmez votre adresse</T>
          <EmailCodeForm
            email={addr}
            onVerify={(code) => verifyEmailCode(addr, code, "signup")}
            onResend={() => resendEmailCode(addr, "signup")}
            submitLabel="Confirmer et me connecter"
          />
          <Button label="Modifier l'adresse" small variant="ghost" onPress={() => setStep("form")} />
        </Panel>
      ) : null}

      {step === "forgot" ? (
        <Panel>
          <T v="heading">Mot de passe oublié</T>
          <T v="small">Nous envoyons un code à 6 chiffres à votre adresse pour choisir un nouveau mot de passe.</T>
          <Field label="E-mail du compte">
            <Input value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          </Field>
          <Button
            label="Recevoir un code"
            loading={busy === "email"}
            disabled={!addr.includes("@")}
            onPress={() =>
              run("email", async () => {
                await requestPasswordReset(addr);
                setStep("reset");
              })
            }
          />
          <Button label="Retour" small variant="ghost" onPress={() => setStep("form")} />
        </Panel>
      ) : null}

      {step === "reset" ? (
        <Panel>
          <T v="heading">Code de réinitialisation</T>
          <EmailCodeForm
            email={addr}
            onVerify={async (code) => {
              resetting.current = true;
              try {
                await verifyEmailCode(addr, code, "recovery");
              } catch (e) {
                resetting.current = false;
                throw e;
              }
              setPassword("");
              setStep("newPassword");
            }}
            onResend={() => requestPasswordReset(addr)}
          />
          <Button label="Retour" small variant="ghost" onPress={() => setStep("form")} />
        </Panel>
      ) : null}

      {step === "newPassword" ? (
        <Panel>
          <T v="heading">Nouveau mot de passe</T>
          <Field label="Nouveau mot de passe" hint="8 caractères minimum.">
            <Input value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
          </Field>
          <Button
            label="Enregistrer"
            loading={busy === "email"}
            disabled={password.length < 8}
            onPress={() =>
              run("email", async () => {
                await setNewPassword(password);
                resetting.current = false;
                setInfo("Mot de passe modifié.");
                router.replace(profile?.username ? (next ?? "/") : withNext("/onboarding", next));
              })
            }
          />
        </Panel>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
      {session && !profile && profileError ? <Notice tone="error">{profileError.message}</Notice> : null}
      {info ? <Notice>{info}</Notice> : null}
    </Screen>
  );
}
