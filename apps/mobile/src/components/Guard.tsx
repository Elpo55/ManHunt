/** Garde d'accès : configuration serveur, session, profil complété. */
import { Redirect, useGlobalSearchParams, usePathname } from "expo-router";
import { useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { safeNext, withNext } from "@traque/shared";
import { Button, Loading, Notice, Screen, T } from "./ui";

/** Profil impossible à charger : jamais d'attente infinie, toujours une issue. */
export function ProfileError() {
  const { profileError, refreshProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <T v="title">Connexion au serveur impossible</T>
      <Notice tone="error" icon="wifi-off">
        {profileError?.message ?? "Le profil n'a pas pu être chargé."}
      </Notice>
      <Button
        label="Réessayer"
        icon="refresh-cw"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          await refreshProfile().finally(() => setBusy(false));
        }}
      />
      <Button label="Se déconnecter" variant="ghost" icon="log-out" onPress={() => void signOut().catch(() => undefined)} />
    </Screen>
  );
}

export function Guard({ children, requireProfile = true }: { children: ReactNode; requireProfile?: boolean }) {
  const { configured, ready, session, profile, profileError } = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  // Page demandée, conservée à travers connexion et création du profil
  // (les paramètres de route dynamiques, déjà présents dans le chemin, sont exclus).
  const query = Object.entries(params)
    .filter(([k, v]) => k !== "next" && typeof v === "string" && !pathname.includes(v))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const here = safeNext(query ? `${pathname}?${query}` : pathname);
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
  if (!session) return <Redirect href={withNext("/login", here)} />;
  if (!profile) return profileError ? <ProfileError /> : <Loading label="Chargement du profil" />;
  if (requireProfile && !profile.username) return <Redirect href={withNext("/onboarding", here)} />;
  return <>{children}</>;
}
