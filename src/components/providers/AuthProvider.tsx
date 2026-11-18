"use client";
/**
 * Session et profil. Deux modes :
 *  - invité : connexion anonyme Supabase (aucune donnée personnelle),
 *  - compte : e-mail + mot de passe ; un invité peut lier un e-mail pour
 *    conserver son profil et ses statistiques.
 */
import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Profile } from "@/lib/api";
import { AppError, toAppError } from "@/lib/errors";
import { getSupabase, isConfigured } from "@/lib/supabase";

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
  if (/Anonymous sign-ins are disabled/i.test(m))
    return new AppError("E_AUTH", "La connexion invité est désactivée sur le serveur (Authentication > Sign In / Providers > Allow anonymous sign-ins).");
  if (/Invalid login credentials/i.test(m)) return new AppError("E_AUTH", "E-mail ou mot de passe incorrect.");
  if (/Email not confirmed/i.test(m)) return new AppError("E_AUTH", "Confirmez d'abord votre e-mail (lien reçu par courriel).");
  if (/already registered|already been registered/i.test(m)) return new AppError("E_AUTH", "Un compte existe déjà avec cet e-mail.");
  if (/rate limit/i.test(m)) return new AppError("E_AUTH", "Trop de tentatives. Réessayez dans quelques minutes.");
  if (/Password should be/i.test(m)) return new AppError("E_AUTH", "Mot de passe trop court (8 caractères minimum).");
  const err = toAppError(e);
  if (m) err.message = m;
  return err;
}

function withMessage(err: AppError): AppError {
  if (err.code === "E_AUTH" && err.detail) err.message = err.detail;
  return err;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    const sb = getSupabase();
    if (!sb || !uid) {
      setProfile(null);
      return;
    }
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
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Différé : éviter d'appeler Supabase dans le callback (verrou interne).
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
        if (error) throw withMessage(authError(error));
      },
      signInEmail: async (email, password) => {
        const { error } = await sb().auth.signInWithPassword({ email, password });
        if (error) throw withMessage(authError(error));
      },
      signUpEmail: async (email, password) => {
        const { data, error } = await sb().auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback/` },
        });
        if (error) throw withMessage(authError(error));
        return { needsConfirmation: !data.session };
      },
      linkEmail: async (email, password) => {
        const { error } = await sb().auth.updateUser(
          { email, password },
          { emailRedirectTo: `${window.location.origin}/auth/callback/` },
        );
        if (error) throw withMessage(authError(error));
      },
      signOut: async () => {
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
