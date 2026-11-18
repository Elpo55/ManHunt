"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { ButtonLink, Notice, Spinner } from "@/components/ui/primitives";

/** Retour du lien de confirmation e-mail : supabase-js échange le code automatiquement. */
export default function AuthCallbackPage() {
  const { ready, session } = useAuth();
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const errorDesc =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.hash.slice(1) || window.location.search).get("error_description")
      : null;

  useEffect(() => {
    if (ready && session) router.replace("/");
  }, [ready, session, router]);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <AppShell requireAuth={false} requireProfile={false}>
      <div className="mx-auto max-w-md space-y-4 pt-6">
        {errorDesc ? (
          <Notice tone="error">{errorDesc}</Notice>
        ) : timedOut ? (
          <Notice tone="warn">La confirmation n&apos;a pas abouti. Le lien a peut-être expiré : reconnectez-vous.</Notice>
        ) : (
          <Spinner label="Validation de votre connexion" />
        )}
        {errorDesc || timedOut ? <ButtonLink href="/login/">Aller à la connexion</ButtonLink> : null}
      </div>
    </AppShell>
  );
}
