"use client";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { Scoreboard } from "@/components/game/Panels";
import { ConnectionBadge } from "@/components/lobby/RoomFrame";
import { ButtonLink, FullScreenStatus, Notice, Panel, Spinner, Stat } from "@/components/ui/primitives";
import { PHASE_LABEL, formatClock } from "@/lib/engine/rules";
import { useGame } from "@/lib/game/useGame";
import { isUuid, useQueryParam } from "@/lib/useQueryParam";

/** Tableau des scores en direct (mis à jour par Realtime). */
function ScoresInner() {
  const raw = useQueryParam("id");
  const gameId = isUuid(raw) ? raw : null;
  const { session } = useAuth();
  const g = useGame(gameId, session?.user.id ?? null);
  const s = g.state;
  if (!gameId) return <FullScreenStatus title="Lien invalide" />;
  if (g.error && !s) return <Notice tone="error">{g.error.message}</Notice>;
  if (!s) return <Spinner />;
  const players = Object.values(s.players);
  const fugActive = players.filter((p) => p.team === "fugitive" && p.status === "active").length;
  const fugTotal = players.filter((p) => p.team === "fugitive").length;
  const captures = players.reduce((a, p) => a + p.captures, 0);
  const remaining = s.game.phase === "paused" ? (s.game.paused_remaining_ms ?? 0) : s.game.phase_ends_at ? s.game.phase_ends_at - g.now : 0;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tableau des scores</h1>
        <ConnectionBadge status={g.connection} />
      </div>
      <Panel>
        <div className="grid grid-cols-3 gap-4">
          <Stat label={PHASE_LABEL[s.game.phase]} value={s.game.phase === "finished" ? "—" : formatClock(remaining)} />
          <Stat label="Fugitifs en jeu" value={`${fugActive}/${fugTotal}`} />
          <Stat label="Captures" value={captures} />
        </div>
      </Panel>
      <Panel>
        <Scoreboard state={s} />
      </Panel>
      <ButtonLink href={s.game.phase === "finished" ? `/results/?id=${s.game.id}` : `/game/?id=${s.game.id}`} block>
        {s.game.phase === "finished" ? "Voir les résultats" : "Retour à la partie"}
      </ButtonLink>
    </div>
  );
}

export default function ScoresPage() {
  return (
    <AppShell>
      <Suspense>
        <ScoresInner />
      </Suspense>
    </AppShell>
  );
}
