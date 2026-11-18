"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DoorOpen, Plus, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { Avatar, ButtonLink, EmptyState, SectionTitle, Spinner, cx } from "@/components/ui/primitives";
import { api, type MyRoom } from "@/lib/api";
import { APP_NAME } from "@/lib/supabase";
import { toAppError } from "@/lib/errors";

const STATUS_LABEL: Record<string, string> = { lobby: "En attente", playing: "Partie en cours", results: "Résultats" };

function Landing() {
  return (
    <div className="pt-6 sm:pt-14">
      <TacticalHero />
      <h1 className="mt-8 max-w-xl text-[2.1rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl">
        Une traque entre amis, sur une carte que personne ne voit en entier.
      </h1>
      <p className="mt-4 max-w-lg text-[17px] leading-relaxed text-fog">
        Les Chasseurs avancent à l&apos;aveugle et guettent chaque impulsion radar. Les Fugitifs se faufilent, brouillent les pistes et tiennent jusqu&apos;au bout du chrono.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/login/" size="lg">
          Commencer à jouer
        </ButtonLink>
        <ButtonLink href="/join/" variant="secondary" size="lg">
          J&apos;ai un code de salon
        </ButtonLink>
      </div>
      <dl className="mt-14 grid gap-6 sm:grid-cols-3">
        {[
          ["2 à 20 joueurs", "Chacun sur son téléphone, depuis n'importe quel réseau."],
          ["Informations cachées", "Vous ne voyez que ce que votre équipe perçoit."],
          ["Radar périodique", "Le serveur révèle des indices à intervalles réglés par l'hôte."],
        ].map(([t, d]) => (
          <div key={t}>
            <dt className="font-medium text-ivory">{t}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-fog">{d}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Vignette de carte tactique : le motif visuel du jeu. */
function TacticalHero() {
  const cells = 15;
  const blocks = new Set(["2,3", "3,3", "3,4", "8,2", "9,2", "11,8", "11,9", "12,9", "5,10", "6,10", "6,11", "1,12", "13,4"]);
  return (
    <div className="relative aspect-[16/9] w-full max-w-xl overflow-hidden rounded-[var(--radius-panel)] bg-graphite" aria-hidden>
      <svg viewBox={`0 0 ${cells * 10} ${cells * 6.2}`} className="absolute inset-0 size-full">
        {Array.from({ length: cells * 10 }, (_, i) => {
          const x = i % cells;
          const y = Math.floor(i / cells);
          if (y > 9) return null;
          const k = `${x},${y}`;
          return blocks.has(k) ? (
            <rect key={k} x={x * 10 + 1} y={y * 10 + 1} width={8} height={8} rx={1.5} fill="var(--slate-2)" />
          ) : (
            <circle key={k} cx={x * 10 + 5} cy={y * 10 + 5} r={0.7} fill="var(--fog-2)" />
          );
        })}
        <circle cx={45} cy={65} r={26} fill="var(--volt)" opacity={0.07} />
        <circle cx={45} cy={65} r={26} fill="none" stroke="var(--volt)" strokeOpacity={0.35} strokeWidth={0.6} />
        <rect x={90} y={10} width={40} height={40} fill="var(--fugitive)" opacity={0.08} />
        <rect x={90} y={10} width={40} height={40} fill="none" stroke="var(--fugitive)" strokeOpacity={0.4} strokeDasharray="2 2" strokeWidth={0.6} />
        <circle cx={45} cy={65} r={3.2} fill="var(--hunter)" />
        <circle cx={55} cy={55} r={3.2} fill="var(--hunter)" opacity={0.85} />
        <circle cx={115} cy={25} r={3.2} fill="none" stroke="var(--fugitive)" strokeWidth={1} strokeDasharray="1.5 1.5" />
      </svg>
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-abyss/80 px-3 py-1.5 text-xs text-fog">
        <span className="live-dot size-1.5 rounded-full bg-fugitive" />
        Contact radar · secteur C1
      </div>
    </div>
  );
}

function Dashboard() {
  const { profile } = useAuth();
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myRooms()
      .then(setRooms)
      .catch((e) => setError(toAppError(e).message));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pt-2">
        <Avatar avatar={profile?.avatar} size={44} />
        <div>
          <p className="text-sm text-fog">Bonjour</p>
          <p className="text-lg font-semibold">{profile?.username}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/rooms/new/" className="group rounded-[var(--radius-panel)] bg-volt p-5 text-white transition-colors hover:bg-[#4a7fff]">
          <Plus className="size-6" aria-hidden />
          <p className="mt-6 text-lg font-semibold">Créer un salon</p>
          <p className="text-sm text-white/75">Vous serez l&apos;hôte et réglerez la partie.</p>
        </Link>
        <Link href="/join/" className="group rounded-[var(--radius-panel)] bg-graphite p-5 transition-colors hover:bg-slate">
          <DoorOpen className="size-6 text-fog" aria-hidden />
          <p className="mt-6 text-lg font-semibold">Rejoindre un salon</p>
          <p className="text-sm text-fog">Avec le code à 6 caractères ou un lien.</p>
        </Link>
      </div>

      <section>
        <SectionTitle>Vos salons</SectionTitle>
        {error ? (
          <p className="text-sm text-hunter">{error}</p>
        ) : rooms === null ? (
          <Spinner />
        ) : rooms.length === 0 ? (
          <EmptyState title="Aucun salon pour l'instant">Créez-en un et partagez le code avec vos amis.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] bg-graphite">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.status === "playing" && r.current_game_id ? `/game/?id=${r.current_game_id}` : `/lobby/?room=${r.id}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-slate"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="text-sm text-fog">
                      <span className="num">{r.code}</span> · {r.members} joueur{r.members > 1 ? "s" : ""}
                      {r.is_host ? " · vous êtes l'hôte" : ""}
                    </p>
                  </div>
                  <span className={cx("text-xs", r.status === "playing" ? "text-volt" : "text-fog")}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  <ChevronRight className="size-4 text-fog-2" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function HomePage() {
  const { session, profile, ready } = useAuth();
  const loggedIn = ready && !!session && !!profile?.username;
  return (
    <AppShell requireAuth={loggedIn} requireProfile={!!session}>
      {loggedIn ? <Dashboard /> : ready ? <Landing /> : <Spinner label={`Chargement de ${APP_NAME}`} />}
    </AppShell>
  );
}
