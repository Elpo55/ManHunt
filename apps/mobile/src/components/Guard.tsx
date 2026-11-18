/** Garde d'accès : configuration serveur, session, profil complété. */
import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { Loading, Notice, Screen, T } from "./ui";

export function Guard({ children, requireProfile = true }: { children: ReactNode; requireProfile?: boolean }) {
  const { configured, ready, session, profile } = useAuth();
  if (!configured) {
    return (
      <Screen>
        <T v="title">Serveur non configuré</T>
        <Notice tone="warn" icon="alert-triangle">
          Les variables EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY sont absentes de cette version de l’application. Suivez SETUP_GUIDE.md.
        </Notice>
      </Screen>
    );
  }
  if (!ready) return <Loading label="Connexion au serveur" />;
  if (!session) return <Redirect href="/login" />;
  if (requireProfile && (!profile || !profile.username)) return profile ? <Redirect href="/onboarding" /> : <Loading />;
  return <>{children}</>;
}
