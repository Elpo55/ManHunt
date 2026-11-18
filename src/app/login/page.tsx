"use client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, Field, Input, Notice, Panel, Segmented } from "@/components/ui/primitives";
import { useQueryParam } from "@/lib/useQueryParam";

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

function LoginInner() {
  const { session, profile, ready, signInGuest, signInEmail, signUpEmail } = useAuth();
  const router = useRouter();
  const next = safeNext(useQueryParam("next"));
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"guest" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !session || !profile) return;
    router.replace(profile.username ? next : `/onboarding/?next=${encodeURIComponent(next)}`);
  }, [ready, session, profile, next, router]);

  async function guest() {
    setBusy("guest");
    setError(null);
    try {
      await signInGuest();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy("email");
    setError(null);
    setInfo(null);
    try {
      if (mode === "signin") await signInEmail(email.trim(), password);
      else {
        const r = await signUpEmail(email.trim(), password);
        if (r.needsConfirmation) setInfo("Compte créé. Ouvrez le lien de confirmation reçu par e-mail, puis connectez-vous.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 pt-4">
      <div>
        <h1 className="text-2xl font-semibold">Connexion</h1>
        <p className="mt-1 text-fog">Le mode invité suffit pour jouer. Un compte garde vos statistiques sur tous vos appareils.</p>
      </div>

      <Panel className="space-y-3">
        <Button size="lg" block onClick={guest} loading={busy === "guest"} disabled={!!busy}>
          Jouer en invité
        </Button>
        <p className="text-sm text-fog">Aucune adresse demandée. Vous pourrez lier un e-mail plus tard depuis votre profil.</p>
      </Panel>

      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Segmented
            label="Type de connexion"
            value={mode}
            onChange={setMode}
            options={[
              { value: "signin", label: "J'ai un compte" },
              { value: "signup", label: "Créer un compte" },
            ]}
          />
          <Field label="E-mail" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Mot de passe" htmlFor="password" hint={mode === "signup" ? "8 caractères minimum." : undefined}>
            <Input
              id="password"
              type="password"
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary" size="lg" block loading={busy === "email"} disabled={!!busy}>
            {mode === "signin" ? "Se connecter" : "Créer le compte"}
          </Button>
        </form>
      </Panel>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? <Notice>{info}</Notice> : null}
    </div>
  );
}

export default function LoginPage() {
  return (
    <AppShell requireAuth={false} requireProfile={false}>
      <Suspense>
        <LoginInner />
      </Suspense>
    </AppShell>
  );
}
