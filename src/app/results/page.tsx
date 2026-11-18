"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { Avatar, ButtonLink, FullScreenStatus, Notice, Panel, SectionTitle, Spinner, Stat, TeamTag, cx } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { TEAM_LABEL, formatDuration } from "@/lib/engine/rules";
import type { Cell, GameEvent } from "@/lib/engine/types";
import { toAppError, type AppError } from "@/lib/errors";
import { describeEvent } from "@/lib/game/journal";
import { fromView, type GameState, type GameView } from "@/lib/game/state";
import { getSupabase } from "@/lib/supabase";
import { isUuid, useQueryParam } from "@/lib/useQueryParam";

const REASON: Record<string, string> = {
  all_captured: "Tous les Fugitifs ont été capturés.",
  time_up: "Les Fugitifs ont tenu jusqu'à la fin du temps.",
  hunters_left: "Tous les Chasseurs ont quitté la partie.",
  fugitives_left: "Tous les Fugitifs ont quitté la partie.",
  aborted: "Partie interrompue par l'hôte (non comptabilisée).",
  no_players: "Plus aucun joueur actif.",
};
const TEAM_COLOR = { hunter: "#ff5a4e", fugitive: "#4fd1a5" };

/** Carte finale : toutes les positions et l'historique complet des déplacements. */
function ReplayMap({ state, trails }: { state: GameState; trails: Record<string, Cell[]> }) {
  const map = state.game.map;
  const s = 10;
  return (
    <svg viewBox={`0 0 ${map.w * s} ${map.h * s}`} className="w-full rounded-[12px] bg-[#0a0c10]" role="img" aria-label="Carte finale et trajets des joueurs">
      {map.rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === "#" ? (
            <rect key={`${x},${y}`} x={x * s + 1} y={y * s + 1} width={s - 2} height={s - 2} rx={1.5} fill="#1c2029" />
          ) : ch === "~" ? (
            <rect key={`${x},${y}`} x={x * s} y={y * s} width={s} height={s} fill="#ff5a4e" opacity={0.12} />
          ) : null,
        ),
      )}
      {Object.entries(trails).map(([u, pts]) => {
        const team = state.final?.find((f) => f.u === u)?.initial_team ?? state.players[u]?.team ?? "fugitive";
        return pts.length > 1 ? (
          <polyline
            key={u}
            points={pts.map((p) => `${p.x * s + s / 2},${p.y * s + s / 2}`).join(" ")}
            fill="none"
            stroke={TEAM_COLOR[team]}
            strokeOpacity={0.35}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        ) : null;
      })}
      {state.final?.map((f) =>
        f.x !== undefined ? (
          <circle
            key={f.u}
            cx={f.x * s + s / 2}
            cy={f.y! * s + s / 2}
            r={3}
            fill={TEAM_COLOR[f.team]}
            opacity={f.status === "active" ? 1 : 0.45}
            stroke={f.u === state.me.u ? "#2f6bff" : "none"}
            strokeWidth={1.5}
          />
        ) : null,
      )}
    </svg>
  );
}

function ResultsInner() {
  const raw = useQueryParam("id");
  const gameId = isUuid(raw) ? raw : null;
  const { session } = useAuth();
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (!gameId || !session) return;
    (async () => {
      try {
        const view: GameView = await api.gameView(gameId);
        setState(fromView(view));
        if (view.game.phase === "finished") {
          // Après la partie, tout l'historique devient lisible (RLS).
          // Pagination : l'API limite chaque réponse (1 000 lignes par défaut).
          const all: GameEvent[] = [];
          for (let page = 0; page < 30; page++) {
            const { data, error: e } = await getSupabase()!
              .from("game_events")
              .select("stream,sn,type,payload,created_at")
              .eq("game_id", gameId)
              .order("id", { ascending: true })
              .range(page * 1000, page * 1000 + 999);
            if (e || !data) break;
            all.push(...data.map((r) => ({ s: r.stream, sn: r.sn, t: r.type, d: r.payload, at: new Date(r.created_at).getTime() })));
            if (data.length < 1000) break;
          }
          setEvents(all);
        }
      } catch (e) {
        setError(toAppError(e));
      }
    })();
  }, [gameId, session]);

  const trails = useMemo(() => {
    const t: Record<string, Cell[]> = {};
    for (const ev of events) {
      if (ev.t !== "move") continue;
      const d = ev.d as { u: string; p: number[][] };
      (t[d.u] ??= []).push(...d.p.map(([x, y]) => ({ x, y })));
    }
    return t;
  }, [events]);

  if (!gameId) return <FullScreenStatus title="Lien invalide" />;
  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (!state) return <Spinner />;
  if (state.game.phase !== "finished") {
    return (
      <FullScreenStatus title="La partie n'est pas terminée">
        <ButtonLink href={`/game/?id=${gameId}`}>Retour à la partie</ButtonLink>
      </FullScreenStatus>
    );
  }

  const w = state.game.winner!;
  const final = state.final ?? [];
  const mine = final.find((f) => f.u === state.me.u);
  const timeline = events
    .filter((e) => ["capture", "player_status", "game_finished", "phase_changed"].includes(e.t))
    .map((e) => ({ e, line: describeEvent(e, state) }))
    .filter((x) => x.line && (x.e.t !== "player_status" || (x.e.d as { status: string }).status === "abandoned"));
  const duration = state.game.running_at && state.game.ended_at ? (state.game.ended_at - state.game.running_at) / 1000 : 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-fog">{state.view.room.name}</p>
        <h1 className={cx("text-3xl font-semibold", w === "hunter" && "text-hunter", w === "fugitive" && "text-fugitive")}>
          {w === "draw" ? "Égalité" : `Victoire des ${TEAM_LABEL[w]}`}
        </h1>
        <p className="mt-1 text-fog">{REASON[state.game.end_reason ?? ""] ?? ""}</p>
      </div>

      {mine ? (
        <Panel>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Votre score" value={mine.score} />
            <Stat label={mine.initial_team === "hunter" ? "Captures" : "Survie"} value={mine.initial_team === "hunter" ? mine.captures : formatDuration(mine.survival_seconds)} />
            <Stat label="Résultat" value={mine.outcome === "win" ? "Gagné" : mine.outcome === "draw" ? "Nul" : "Perdu"} />
          </div>
        </Panel>
      ) : null}

      <Panel className="p-0 sm:p-0">
        <h2 className="px-4 pt-4 font-semibold">Classement de la partie</h2>
        <ol className="divide-y divide-line">
          {final.map((f, i) => {
            const p = state.players[f.u];
            return (
              <li key={f.u} className={cx("flex items-center gap-3 px-4 py-3", f.u === state.me.u && "bg-volt-soft")}>
                <span className="num w-5 text-fog">{i + 1}</span>
                <Avatar avatar={p?.avatar} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p?.username ?? "Joueur"}</p>
                  <p className="text-xs text-fog">
                    {f.initial_team === "hunter" ? `${f.captures} capture${f.captures > 1 ? "s" : ""}` : `survie ${formatDuration(f.survival_seconds)}`}
                    {f.status === "abandoned" ? " · abandon" : f.status === "captured" ? " · capturé" : ""}
                  </p>
                </div>
                <TeamTag team={f.initial_team} />
                <span className="num w-14 text-right">{f.score}</span>
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel>
        <SectionTitle>Carte finale et trajets</SectionTitle>
        <ReplayMap state={state} trails={trails} />
        <p className="mt-2 text-xs text-fog">Durée de traque : {formatDuration(duration)}. Toutes les positions sont révélées en fin de partie.</p>
      </Panel>

      {timeline.length ? (
        <Panel>
          <SectionTitle>Chronologie</SectionTitle>
          <ol className="space-y-2 text-sm">
            {timeline.map(({ e, line }) => (
              <li key={`${e.s}:${e.sn}`} className="flex gap-3">
                <span className="num w-12 shrink-0 text-xs text-fog-2">
                  {state.game.running_at ? formatClockShort(e.at - state.game.running_at) : ""}
                </span>
                <span className={line!.tone === "hunter" ? "text-hunter" : "text-ivory"}>{line!.text}</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <ButtonLink href={`/lobby/?room=${state.view.room.id}`}>Retour au salon</ButtonLink>
        <ButtonLink href="/stats/" variant="secondary">
          Mes statistiques
        </ButtonLink>
      </div>
    </div>
  );
}

function formatClockShort(ms: number) {
  if (ms < 0) return "prép.";
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export default function ResultsPage() {
  return (
    <AppShell>
      <Suspense>
        <ResultsInner />
      </Suspense>
    </AppShell>
  );
}
