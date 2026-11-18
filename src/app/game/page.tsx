"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Crosshair, Gamepad2, List, LocateFixed, Menu, Minus, Pause, Play, Plus, Square, X } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { GameMap, type MapHandle } from "@/components/game/GameMap";
import { ActionBar, DPad, StepsMeter } from "@/components/game/Controls";
import { JournalPanel, PlayersPanel, RadarPanel, Scoreboard } from "@/components/game/Panels";
import { ConnectionBadge } from "@/components/lobby/RoomFrame";
import { Dialog, useToast } from "@/components/ui/overlay";
import { Button, ButtonLink, FullScreenStatus, Notice, Segmented, Spinner, cx } from "@/components/ui/primitives";
import { blockedSet, chebyshev, findPath, isWalkable, reachable } from "@/lib/engine/grid";
import { ABILITIES, PHASE_LABEL, TEAM_LABEL, TEAM_SINGULAR, availableSteps, formatClock } from "@/lib/engine/rules";
import type { AbilityKey, Cell, GameEvent } from "@/lib/engine/types";
import { describeEvent } from "@/lib/game/journal";
import type { GameState } from "@/lib/game/state";
import { useGame } from "@/lib/game/useGame";
import { useSettings, vibrate } from "@/lib/settings";
import { isUuid, useQueryParam } from "@/lib/useQueryParam";
import type { AppError } from "@/lib/errors";

type Tab = "journal" | "players" | "radar" | "scores";

function Timer({ state, now }: { state: GameState; now: number }) {
  const g = state.game;
  let ms = 0;
  if (g.phase === "paused") ms = g.paused_remaining_ms ?? 0;
  else if (g.phase_ends_at) ms = g.phase_ends_at - now;
  const urgent = g.phase === "running" && ms < 60_000;
  return (
    <div className="flex flex-col items-center leading-none">
      <span className={cx("num text-[28px]", urgent ? "text-hunter" : "text-ivory")} aria-live="off">
        {g.phase === "finished" ? "00:00" : formatClock(ms)}
      </span>
      <span className="mt-1 text-[11px] text-fog">{PHASE_LABEL[g.phase]}</span>
    </div>
  );
}

function GameInner() {
  const raw = useQueryParam("id");
  const gameId = isUuid(raw) ? raw : null;
  const { session, ready, configured } = useAuth();
  const userId = session?.user.id ?? null;
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (configured && ready && !session) router.replace(`/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [configured, ready, session, router]);
  const settings = useSettings();
  const mapRef = useRef<MapHandle>(null);
  const [tab, setTab] = useState<Tab>("journal");
  const [sheet, setSheet] = useState(false);
  const [hostMenu, setHostMenu] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [pendingPath, setPendingPath] = useState<Cell[] | null>(null);
  const [targeting, setTargeting] = useState<AbilityKey | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [showPad, setShowPad] = useState(false);

  const onEvent = useCallback(
    (ev: GameEvent, s: GameState) => {
      const line = describeEvent(ev, s);
      if (!line?.notify) return;
      if (ev.t === "capture_missed") return; // déjà signalé par l'action
      const tone = line.tone === "hunter" ? "hunter" : line.tone === "fugitive" ? "fugitive" : line.tone === "alert" ? "error" : "info";
      toast.push(line.text, tone);
      if (ev.t === "capture" || ev.t === "alert") vibrate([120, 60, 120]);
      else if (ev.t === "radar" || ev.t === "radar_ping") vibrate(40);
    },
    [toast],
  );
  const zoomIn = useCallback(() => mapRef.current?.zoom(1.2), []);
  const zoomOut = useCallback(() => mapRef.current?.zoom(0.83), []);
  const recenter = useCallback(() => mapRef.current?.recenter(), []);
  const onError = useCallback((e: AppError) => toast.push(e.message, "error"), [toast]);
  const g = useGame(gameId, userId, onEvent, onError);
  const s = g.state;

  const blocked = useMemo(() => (s ? blockedSet(s.effects, g.now) : new Set<string>()), [s, g.now]);
  const steps = s ? availableSteps(s.me, s.game.config, g.now).steps : 0;
  const canMove =
    !!s && s.me.status === "active" && (s.game.phase === "running" || (s.game.phase === "preparation" && s.me.team === "fugitive"));
  const reach = useMemo(
    () => (s && canMove && !targeting ? reachable(s.game.map, s.me, steps, blocked) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s?.me.x, s?.me.y, s?.game.map, steps, blocked, canMove, targeting],
  );

  const doMove = useCallback(
    async (path: Cell[]) => {
      setPendingPath(null);
      const ok = await g.controller!.move(path);
      if (ok) vibrate(15);
    },
    [g.controller],
  );

  const onCellTap = useCallback(
    (c: Cell) => {
      if (!s) return;
      if (targeting) {
        const meta = ABILITIES[targeting];
        if (chebyshev(s.me, c) > (meta.range ?? 5)) {
          toast.push(`Hors de portée (${meta.range} cases maximum).`, "error");
          return;
        }
        setHover(c);
        void g.controller!.ability(targeting, c).then((ok) => ok && setTargeting(null));
        return;
      }
      if (!canMove) {
        if (s.game.phase === "preparation" && s.me.team === "hunter") toast.push("Les Chasseurs attendent la fin de la préparation.");
        return;
      }
      if (pendingPath?.length) {
        const last = pendingPath[pendingPath.length - 1];
        if (last.x === c.x && last.y === c.y) {
          void doMove(pendingPath);
          return;
        }
      }
      if (!isWalkable(s.game.map, c.x, c.y, blocked)) {
        setPendingPath(null);
        return;
      }
      const path = findPath(s.game.map, s.me, c, blocked);
      if (!path || !path.length) {
        setPendingPath(null);
        return;
      }
      if (steps === 0) {
        toast.push("Aucun pas disponible : patientez un instant.");
        return;
      }
      const trimmed = path.slice(0, steps);
      if (settings.confirmMoves) setPendingPath(trimmed);
      else void doMove(trimmed);
    },
    [s, targeting, canMove, pendingPath, blocked, steps, settings.confirmMoves, doMove, g.controller, toast],
  );

  const step = useCallback(
    (dx: number, dy: number) => {
      if (!s || !canMove) return;
      const c = { x: s.me.x + dx, y: s.me.y + dy };
      if (!isWalkable(s.game.map, c.x, c.y, blocked)) {
        toast.push("Case bloquée.");
        return;
      }
      if (steps === 0) {
        toast.push("Aucun pas disponible : patientez un instant.");
        return;
      }
      void doMove([c]);
    },
    [s, canMove, blocked, steps, doMove, toast],
  );

  const capture = useCallback(async () => {
    const r = await g.controller!.capture();
    if (r === null) return;
    if (r.length === 0) {
      toast.push("Capture manquée : personne à portée.");
      vibrate(30);
    }
  }, [g.controller, toast]);

  const onAbility = useCallback(
    (k: AbilityKey) => {
      if (ABILITIES[k].targeting === "cell") {
        setPendingPath(null);
        setTargeting((cur) => (cur === k ? null : k));
        return;
      }
      void g.controller!.ability(k, null);
    },
    [g.controller],
  );

  // Clavier (desktop) : flèches / ZQSD, espace = capture, Échap = annuler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,[role=dialog]")) return;
      const k = e.key.toLowerCase();
      const dirs: Record<string, [number, number]> = {
        arrowup: [0, -1], z: [0, -1], w: [0, -1],
        arrowdown: [0, 1], s: [0, 1],
        arrowleft: [-1, 0], q: [-1, 0], a: [-1, 0],
        arrowright: [1, 0], d: [1, 0],
      };
      if (dirs[k]) {
        e.preventDefault();
        step(...dirs[k]);
      } else if (k === " " && s?.me.team === "hunter") {
        e.preventDefault();
        void capture();
      } else if (k === "escape") {
        setTargeting(null);
        setPendingPath(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, capture, s?.me.team]);

  if (!gameId) {
    return (
      <FullScreenStatus title="Lien de partie invalide">
        <ButtonLink href="/">Accueil</ButtonLink>
      </FullScreenStatus>
    );
  }
  if (g.error && !s) {
    return (
      <FullScreenStatus title="Partie inaccessible">
        <Notice tone="error">{g.error.message}</Notice>
        <ButtonLink href="/" variant="secondary">
          Accueil
        </ButtonLink>
      </FullScreenStatus>
    );
  }
  if (!s || !userId) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner label="Synchronisation avec le serveur" />
      </div>
    );
  }

  const isHost = s.view.room.host_id === userId;
  const lobbyHref = `/lobby/?room=${s.view.room.id}`;
  const finished = s.game.phase === "finished";
  const tabs = (
    <>
      <Segmented
        label="Informations"
        value={tab}
        onChange={setTab}
        options={[
          { value: "journal", label: "Journal" },
          { value: "players", label: "Joueurs" },
          { value: "radar", label: "Radar" },
          { value: "scores", label: "Scores" },
        ]}
      />
      <div className="mt-4">
        {tab === "journal" ? <JournalPanel state={s} /> : null}
        {tab === "players" ? <PlayersPanel state={s} online={g.online} hostId={s.view.room.host_id} /> : null}
        {tab === "radar" ? <RadarPanel state={s} now={g.now} /> : null}
        {tab === "scores" ? <Scoreboard state={s} /> : null}
      </div>
    </>
  );

  const banner =
    s.game.phase === "paused" ? (
      "Partie en pause par l'hôte."
    ) : s.game.phase === "preparation" ? (
      s.me.team === "fugitive" ? "Préparation : cachez-vous, les Chasseurs ne voient rien." : "Préparation : les Fugitifs se cachent. Vous partirez au signal."
    ) : s.me.status === "captured" ? (
      "Vous avez été capturé. Vous suivez votre équipe jusqu'à la fin."
    ) : s.me.status === "abandoned" ? (
      "Vous avez quitté cette partie."
    ) : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-abyss">
      {/* HUD */}
      <header className="safe-top z-20 bg-abyss/90 backdrop-blur-md">
        <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={lobbyHref} className="rounded-full p-2 text-fog hover:text-ivory" aria-label="Retour au salon">
              <ArrowLeft className="size-5" />
            </Link>
            <div className="min-w-0">
              <p className={cx("truncate text-sm font-medium", s.me.team === "hunter" ? "text-hunter" : "text-fugitive")}>
                {TEAM_SINGULAR[s.me.team]}
              </p>
              <ConnectionBadge status={g.connection} />
            </div>
          </div>
          <Timer state={s} now={g.now} />
          <div className="flex items-center justify-end gap-1">
            <button className="rounded-full p-2 text-fog hover:text-ivory lg:hidden" onClick={() => setSheet(true)} aria-label="Journal et informations">
              <List className="size-5" />
            </button>
            <button className="rounded-full p-2 text-fog hover:text-ivory" onClick={() => setHostMenu(true)} aria-label="Menu de partie">
              <Menu className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 lg:grid lg:grid-cols-[300px_1fr_320px]">
        <aside className="hidden overflow-y-auto bg-graphite p-4 lg:block">
          <h2 className="mb-3 text-sm font-semibold">Joueurs</h2>
          <PlayersPanel state={s} online={g.online} hostId={s.view.room.host_id} />
          <h2 className="mb-3 mt-6 text-sm font-semibold">Radar</h2>
          <RadarPanel state={s} now={g.now} />
        </aside>

        <div className="relative min-h-0 flex-1">
          <GameMap
            ref={mapRef}
            state={s}
            now={g.now}
            reachable={reach}
            path={pendingPath}
            target={targeting ? { range: ABILITIES[targeting].range ?? 5, radius: targeting === "scan" ? 2 : 0 } : null}
            hover={hover}
            showCoordinates={settings.showCoordinates}
            onCellTap={onCellTap}
          />
          {banner ? (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
              <p className="rounded-full bg-graphite/95 px-4 py-2 text-center text-sm text-ivory shadow-lg shadow-black/40">{banner}</p>
            </div>
          ) : null}
          <div className="absolute right-3 top-14 flex flex-col gap-1.5">
            <MapButton label="Zoom avant" onClick={zoomIn}>
              <Plus className="size-4" />
            </MapButton>
            <MapButton label="Zoom arrière" onClick={zoomOut}>
              <Minus className="size-4" />
            </MapButton>
            <MapButton label="Recentrer" onClick={recenter}>
              <LocateFixed className="size-4" />
            </MapButton>
          </div>
          {pendingPath?.length || targeting ? (
            <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-[14px] bg-graphite/95 p-2 pl-4 shadow-lg shadow-black/40">
              <span className="text-sm">
                {targeting
                  ? `${ABILITIES[targeting].name} : touchez une case à ${ABILITIES[targeting].range} cases maximum.`
                  : `Déplacement de ${pendingPath!.length} case${pendingPath!.length > 1 ? "s" : ""}. Touchez à nouveau pour confirmer.`}
              </span>
              <div className="flex gap-1.5">
                {pendingPath?.length && !targeting ? (
                  <Button size="sm" loading={g.pending === "move"} onClick={() => doMove(pendingPath)}>
                    Aller
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Annuler"
                  onClick={() => {
                    setPendingPath(null);
                    setTargeting(null);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="hidden overflow-y-auto bg-graphite p-4 lg:block">
          <h2 className="mb-3 text-sm font-semibold">Journal</h2>
          <JournalPanel state={s} />
        </aside>
      </div>

      {/* Dock de contrôle */}
      <footer className="safe-bottom z-20 bg-graphite">
        <div className="mx-auto max-w-3xl space-y-2.5 px-3 pb-3 pt-2.5">
          <div className="flex items-center justify-between gap-3">
            <StepsMeter state={s} now={g.now} />
            <div className="flex items-center gap-3 text-xs text-fog">
              {s.me.team === "hunter" ? (
                <span className="flex items-center gap-1">
                  <Crosshair className="size-3.5" aria-hidden /> {s.me.captures}
                </span>
              ) : null}
              <button
                className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1.5", showPad ? "bg-slate-2 text-ivory" : "text-fog")}
                onClick={() => setShowPad((v) => !v)}
                aria-pressed={showPad}
              >
                <Gamepad2 className="size-4" aria-hidden /> Pas à pas
              </button>
            </div>
          </div>
          <div className="flex items-end gap-2.5">
            {showPad ? <DPad onStep={step} disabled={!canMove || g.pending === "move"} /> : null}
            <div className="min-w-0 flex-1">
              <ActionBar
                state={s}
                now={g.now}
                pending={g.pending}
                targeting={targeting}
                onCapture={capture}
                onRadar={() => void g.controller!.radar()}
                onAbility={onAbility}
              />
            </div>
          </div>
        </div>
      </footer>

      {/* Feuille d'informations (mobile) */}
      <Dialog open={sheet} onOpenChange={setSheet} title="Informations de partie">
        {tabs}
      </Dialog>

      {/* Menu de partie */}
      <Dialog open={hostMenu} onOpenChange={setHostMenu} title="Partie" description={`Salon ${s.view.room.name} · code ${s.view.room.code}`}>
        <div className="space-y-2">
          <ButtonLink href={`/game/scores/?id=${s.game.id}`} variant="secondary" block>
            Tableau des scores
          </ButtonLink>
          {isHost && !finished ? (
            <>
              {s.game.phase === "paused" ? (
                <Button block icon={<Play className="size-4" />} loading={g.pending === "resume"} onClick={() => void g.controller!.resume().then(() => setHostMenu(false))}>
                  Reprendre la partie
                </Button>
              ) : (
                <Button variant="secondary" block icon={<Pause className="size-4" />} loading={g.pending === "pause"} onClick={() => void g.controller!.pause().then(() => setHostMenu(false))}>
                  Mettre en pause
                </Button>
              )}
              <Button variant="danger" block icon={<Square className="size-4" />} onClick={() => setConfirmAbort(true)}>
                Interrompre la partie
              </Button>
            </>
          ) : null}
          {!finished && s.me.status === "active" ? (
            <Button variant="ghost" block onClick={() => setConfirmLeave(true)}>
              Abandonner la partie
            </Button>
          ) : null}
          {g.connection !== "live" ? (
            <Button variant="ghost" block onClick={() => g.controller?.scheduleResync(0)}>
              Resynchroniser maintenant
            </Button>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={confirmAbort}
        onOpenChange={setConfirmAbort}
        title="Interrompre la partie ?"
        description="La partie se termine sur une égalité et ne compte pas dans les statistiques."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmAbort(false)}>
              Continuer à jouer
            </Button>
            <Button variant="danger" loading={g.pending === "abort"} onClick={() => void g.controller!.abort().then(() => { setConfirmAbort(false); setHostMenu(false); })}>
              Interrompre
            </Button>
          </>
        }
      />
      <Dialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Abandonner la partie ?"
        description="Vous ne pourrez plus jouer cette manche. Votre équipe continue sans vous."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
              Rester
            </Button>
            <Button
              variant="danger"
              loading={g.pending === "leave"}
              onClick={() =>
                void g.controller!.leave().then(() => {
                  setConfirmLeave(false);
                  router.push(lobbyHref);
                })
              }
            >
              Abandonner
            </Button>
          </>
        }
      />

      {/* Fin de partie */}
      {finished ? (
        <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-abyss via-abyss/95 to-transparent px-4 pb-6 pt-16 safe-bottom">
          <div className="mx-auto max-w-md rounded-[20px] bg-graphite p-5 shadow-2xl shadow-black/60">
            <EndSummary state={s} />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <ButtonLink href={`/results/?id=${s.game.id}`}>Résultats</ButtonLink>
              <ButtonLink href={lobbyHref} variant="secondary">
                Retour au salon
              </ButtonLink>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex size-10 items-center justify-center rounded-[10px] bg-graphite/95 text-fog hover:text-ivory">
      {children}
    </button>
  );
}

function EndSummary({ state }: { state: GameState }) {
  const w = state.game.winner;
  const mine = state.final?.find((f) => f.u === state.me.u);
  const title = w === "draw" ? "Égalité" : `Victoire des ${TEAM_LABEL[w!]}`;
  return (
    <div>
      <p className={cx("text-2xl font-semibold", w === "hunter" && "text-hunter", w === "fugitive" && "text-fugitive")}>{title}</p>
      {mine ? (
        <p className="mt-1 text-fog">
          {mine.outcome === "win" ? "Vous avez gagné" : mine.outcome === "draw" ? "Match nul" : "Vous avez perdu"} · <span className="num text-ivory">{mine.score}</span> points
        </p>
      ) : null}
    </div>
  );
}

export default function GamePage() {
  return (
    <Suspense>
      <GameInner />
    </Suspense>
  );
}
