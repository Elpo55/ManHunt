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
  /** Échec du chargement du profil (réseau, serveur) : l'interface propose de réessayer. */
  profileError: AppError | null;
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
  const [profileError, setProfileError] = useState<AppError | null>(null);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    const sb = getSupabase();
    if (!sb || !uid) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    // Le profil est créé par un déclencheur à l'inscription : on retente
    // brièvement s'il n'est pas encore visible, puis on signale l'échec
    // au lieu de rester indéfiniment sur « Chargement ».
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
        if (error) throw error;
        if (data) {
          setProfile(data as Profile);
          setProfileError(null);
          return;
        }
      } catch (e) {
        if (attempt === 2) {
          setProfile(null);
          setProfileError(toAppError(e));
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
    setProfile(null);
    setProfileError(new AppError("E_PROFILE_MISSING"));
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    sb.auth
      .getSession()
      .then(async ({ data }) => {
        if (!alive) return;
        setSession(data.session);
        await loadProfile(data.session?.user.id);
      })
      .catch((e) => {
        if (alive) setProfileError(toAppError(e));
      })
      .finally(() => {
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
      profileError,
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
        setProfileError(null);
      },
    };
  }, [ready, session, profile, profileError, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth hors AuthProvider");
  return c;
}
