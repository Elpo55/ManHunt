/**
 * Session et profil. Invité (connexion anonyme, aucune donnée personnelle)
 * ou e-mail + mot de passe ; un invité peut lier un e-mail pour garder son profil.
 */
import type { Session } from "@supabase/supabase-js";
import { AppError, toAppError } from "@traque/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Profile } from "./api";
import { isConfigured } from "./env";
import { stopTracking } from "./location/tracking";
import { getSupabase } from "./supabase";

interface AuthCtx {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signInGuest: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  linkEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function authError(e: { message?: string } | null): AppError {
  const m = e?.message ?? "";
  const map: [RegExp, string][] = [
    [/Anonymous sign-ins are disabled/i, "Le mode invité est désactivé sur le serveur (Supabase > Authentication > Sign In / Providers)."],
    [/Invalid login credentials/i, "E-mail ou mot de passe incorrect."],
    [/Email not confirmed/i, "Confirmez d'abord votre e-mail."],
    [/already registered/i, "Un compte existe déjà avec cet e-mail."],
    [/rate limit/i, "Trop de tentatives. Réessayez dans quelques minutes."],
    [/Password should be/i, "Mot de passe trop court (8 caractères minimum)."],
  ];
  for (const [re, text] of map) if (re.test(m)) {
    const err = new AppError("E_AUTH");
    err.message = text;
    return err;
  }
  const err = toAppError(e);
  if (m && err.code === "E_INTERNAL") err.message = m;
  return err;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    const sb = getSupabase();
    if (!sb || !uid) return setProfile(null);
    const { data } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    sb.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (alive) setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setTimeout(() => void loadProfile(s?.user.id), 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthCtx>(() => {
    const sb = () => {
      const c = getSupabase();
      if (!c) throw new AppError("E_NOT_CONFIGURED");
      return c;
    };
    return {
      ready,
      configured: isConfigured,
      session,
      profile,
      refreshProfile: () => loadProfile(session?.user.id),
      signInGuest: async () => {
        const { error } = await sb().auth.signInAnonymously();
        if (error) throw authError(error);
      },
      signInEmail: async (email, password) => {
        const { error } = await sb().auth.signInWithPassword({ email, password });
        if (error) throw authError(error);
      },
      signUpEmail: async (email, password) => {
        const { data, error } = await sb().auth.signUp({ email, password });
        if (error) throw authError(error);
        return { needsConfirmation: !data.session };
      },
      linkEmail: async (email, password) => {
        const { error } = await sb().auth.updateUser({ email, password });
        if (error) throw authError(error);
      },
      signOut: async () => {
        await stopTracking(); // aucun partage ne survit à une déconnexion
        await sb().auth.signOut();
        setProfile(null);
      },
    };
  }, [ready, session, profile, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth hors AuthProvider");
  return c;
}
