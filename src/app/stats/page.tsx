"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { EmptyState, ButtonLink, Panel, SectionTitle, Spinner, Stat, TeamTag, cx } from "@/components/ui/primitives";
import { formatDuration } from "@/lib/engine/rules";
import type { Team } from "@/lib/engine/types";
import { getSupabase } from "@/lib/supabase";

interface Row {
  game_id: string;
  team: Team;
  initial_team: Team;
  outcome: "win" | "loss" | "draw";
  captures: number;
  survival_seconds: number;
  distance: number;
  score: number;
  counted: boolean;
  created_at: string;
}

export default function StatsPage() {
  const { profile, session } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    getSupabase()!
      .from("game_statistics")
      .select("game_id,team,initial_team,outcome,captures,survival_seconds,distance,score,counted,created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error: e }) => {
        if (e) setError("Impossible de charger l'historique.");
        else setRows((data as Row[]) ?? []);
      });
  }, [session]);

  const counted = rows?.filter((r) => r.counted) ?? [];
  const asHunter = counted.filter((r) => r.initial_team === "hunter");
  const asFugitive = counted.filter((r) => r.initial_team === "fugitive");
  const rate = (list: Row[]) => (list.length ? `${Math.round((100 * list.filter((r) => r.outcome === "win").length) / list.length)} %` : "—");
  const best = counted.reduce((m, r) => Math.max(m, r.score), 0);
  const dist = counted.reduce((m, r) => m + r.distance, 0);

  return (
    <AppShell>
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold">Statistiques</h1>
        {profile ? (
          <Panel>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="Parties" value={profile.games_played} />
              <Stat label="Victoires" value={profile.wins} sub={`${profile.losses} défaites · ${profile.draws} nuls`} />
              <Stat label="Score total" value={profile.total_score} />
              <Stat label="Meilleur score" value={best || "—"} />
              <Stat label="Victoires en Chasseur" value={rate(asHunter)} sub={`${asHunter.length} parties`} />
              <Stat label="Victoires en Fugitif" value={rate(asFugitive)} sub={`${asFugitive.length} parties`} />
              <Stat label="Captures" value={profile.captures} sub={`capturé ${profile.times_captured} fois`} />
              <Stat label="Cases parcourues" value={dist} />
            </div>
          </Panel>
        ) : null}

        <section>
          <SectionTitle>Historique</SectionTitle>
          {error ? (
            <p className="text-sm text-hunter">{error}</p>
          ) : rows === null ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState title="Aucune partie jouée" action={<ButtonLink href="/rooms/new/">Créer un salon</ButtonLink>}>
              Vos résultats apparaîtront ici après votre première partie.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] bg-graphite">
              {rows.map((r) => (
                <li key={r.game_id}>
                  <Link href={`/results/?id=${r.game_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate">
                    <span
                      className={cx(
                        "w-14 text-sm font-medium",
                        r.outcome === "win" ? "text-fugitive" : r.outcome === "loss" ? "text-hunter" : "text-fog",
                      )}
                    >
                      {r.outcome === "win" ? "Victoire" : r.outcome === "loss" ? "Défaite" : "Nul"}
                    </span>
                    <TeamTag team={r.initial_team} />
                    <span className="min-w-0 flex-1 truncate text-sm text-fog">
                      {r.initial_team === "hunter" ? `${r.captures} capture${r.captures > 1 ? "s" : ""}` : `survie ${formatDuration(r.survival_seconds)}`}
                      {!r.counted ? " · non comptée" : ""}
                    </span>
                    <span className="num text-sm">{r.score}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
