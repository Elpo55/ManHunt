"use client";
/**
 * Coque d'application : en-tête compact + navigation basse sur mobile,
 * navigation latérale implicite (en-tête) sur desktop. Garde d'accès :
 * redirige vers la connexion ou la création de profil si nécessaire.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Home, LogIn, Settings, Trophy, User } from "lucide-react";
import { useAuth } from "./providers/AuthProvider";
import { Avatar, ButtonLink, FullScreenStatus, Notice, Spinner, cx } from "./ui/primitives";
import { APP_NAME } from "@/lib/supabase";

const NAV = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/leaderboard/", label: "Classement", icon: Trophy },
  { href: "/profile/", label: "Profil", icon: User },
  { href: "/settings/", label: "Réglages", icon: Settings },
];

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cx("flex items-center gap-2.5 text-ivory", className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6}>
        <circle cx="12" cy="12" r="9" className="text-fog-2" stroke="currentColor" />
        <circle cx="12" cy="12" r="4.5" stroke="var(--volt)" />
        <path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" stroke="currentColor" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
    </Link>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href.replace(/\/$/, ""));
}

export function AppShell({
  children,
  requireAuth = true,
  requireProfile = true,
  wide = false,
}: {
  children: ReactNode;
  requireAuth?: boolean;
  requireProfile?: boolean;
  wide?: boolean;
}) {
  const { ready, configured, session, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  const needsLogin = requireAuth && ready && configured && !session;
  const needsProfile = requireProfile && ready && configured && session && profile && !profile.username;

  useEffect(() => {
    const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    if (needsLogin) router.replace(`/login/?next=${encodeURIComponent(next)}`);
    else if (needsProfile) router.replace(`/onboarding/?next=${encodeURIComponent(next)}`);
  }, [needsLogin, needsProfile, router]);

  let content: ReactNode = children;
  if (!configured) {
    content = (
      <FullScreenStatus title="Serveur non configuré">
        <Notice tone="warn">
          Les variables <code>NEXT_PUBLIC_SUPABASE_URL</code> et <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> sont absentes.
          Suivez le fichier SETUP_GUIDE.md pour connecter l&apos;application à Supabase.
        </Notice>
      </FullScreenStatus>
    );
  } else if (!ready || (requireAuth && (!session || (requireProfile && (!profile || !profile.username))))) {
    content = (
      <div className="px-5 py-16">
        <Spinner label={ready ? "Redirection" : "Connexion au serveur"} />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-30 bg-abyss/85 backdrop-blur-md">
        <div className={cx("mx-auto flex h-14 items-center justify-between gap-4 px-4", wide ? "max-w-6xl" : "max-w-3xl")}>
          <Brand />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className={cx(
                  "rounded-[8px] px-3 py-2 text-sm transition-colors",
                  isActive(pathname, n.href) ? "bg-slate text-ivory" : "text-fog hover:text-ivory",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          {session && profile?.username ? (
            <Link href="/profile/" className="flex items-center gap-2 text-sm text-fog hover:text-ivory md:hidden">
              <Avatar avatar={profile.avatar} size={30} />
            </Link>
          ) : configured && ready && !session ? (
            <ButtonLink href="/login/" variant="ghost" size="sm" icon={<LogIn className="size-4" />}>
              Connexion
            </ButtonLink>
          ) : null}
        </div>
      </header>

      <main className={cx("mx-auto w-full flex-1 px-4 pb-28 pt-4 md:pb-12", wide ? "max-w-6xl" : "max-w-3xl")}>
        {content}
      </main>

      {session ? (
        <nav
          aria-label="Navigation"
          className="safe-bottom fixed inset-x-0 bottom-0 z-30 bg-graphite/95 backdrop-blur-md md:hidden"
        >
          <div className="mx-auto grid max-w-md grid-cols-4">
            {NAV.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-16 flex-col items-center justify-center gap-1 text-[11px]",
                    active ? "text-ivory" : "text-fog",
                  )}
                >
                  <n.icon className={cx("size-5", active && "text-volt")} aria-hidden />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
