"use client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { ProfileForm } from "@/components/ProfileForm";
import { useAuth } from "@/components/providers/AuthProvider";
import { Panel, Spinner } from "@/components/ui/primitives";
import { useQueryParam } from "@/lib/useQueryParam";

function OnboardingInner() {
  const router = useRouter();
  const raw = useQueryParam("next");
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  const { profile } = useAuth();

  useEffect(() => {
    if (profile?.username) router.replace(next);
  }, [profile?.username, next, router]);

  if (!profile) return <Spinner />;
  return (
    <div className="mx-auto max-w-md space-y-5 pt-4">
      <div>
        <h1 className="text-2xl font-semibold">Votre profil de joueur</h1>
        <p className="mt-1 text-fog">Choisissez un pseudo et un emblème. Vous pourrez les changer à tout moment.</p>
      </div>
      <Panel>
        <ProfileForm submitLabel="Continuer" onSaved={() => router.replace(next)} />
      </Panel>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <AppShell requireProfile={false}>
      <Suspense>
        <OnboardingInner />
      </Suspense>
    </AppShell>
  );
}
