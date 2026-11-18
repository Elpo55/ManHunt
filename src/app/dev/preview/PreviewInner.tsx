"use client";
/**
 * Aperçu visuel de l'écran de jeu SANS serveur — outil de développement.
 * N'est rendu qu'avec `npm run dev` (NODE_ENV=development) ; en production
 * la page affiche un simple message. Données entièrement fictives.
 */
import { useMemo, useState } from "react";
import { GameMap } from "@/components/game/GameMap";
import { ActionBar, StepsMeter } from "@/components/game/Controls";
import { JournalPanel, PlayersPanel, RadarPanel } from "@/components/game/Panels";
import { DEFAULT_CONFIG } from "@/lib/engine/config";
import { reachable } from "@/lib/engine/grid";
import { formatClock } from "@/lib/engine/rules";
import { fromView, type GameView } from "@/lib/game/state";
import type { Team } from "@/lib/engine/types";

function demoView(team: Team): GameView {
  const w = 22;
  const rows = Array.from({ length: w }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      if (x >= 14 && x <= 16 && y >= 3 && y <= 5) return "~";
      return r < 0.15 && !(x === 6 && y === 12) ? "#" : ".";
    }).join(""),
  );
  const now = Date.now();
  const me = team === "hunter" ? { x: 6, y: 12 } : { x: 15, y: 9 };
  return {
    server_now: now,
    game: {
      id: "demo", room_id: "demo", mode: "classic", phase: "running", config: DEFAULT_CONFIG,
      map: { w, h: w, rows }, started_at: now - 200_000, running_at: now - 140_000, phase_started_at: now - 140_000,
      phase_ends_at: now + 512_000, paused_from: null, paused_remaining_ms: null, next_radar_at: now + 23_000,
      ended_at: null, winner: null, end_reason: null, radar_state: {},
    },
    room: { id: "demo", code: "K7M2QX", name: "Salon de démonstration", host_id: "me" },
    me: { u: "me", team, initial_team: team, status: "active", x: me.x, y: me.y, steps: 2, steps_at: now - 900,
          ghost_until: null, jam_until: null, boost_until: null, last_capture_at: now - 2000, captures: 1 },
    players: [
      { u: "me", username: "Vous", avatar: "orbit:azure", team, status: "active", connected: true, captures: 1 },
      { u: "a", username: "Iris", avatar: "prism:ember", team, status: "active", connected: true, captures: 0 },
      { u: "b", username: "Malo", avatar: "delta:mint", team: team === "hunter" ? "fugitive" : "hunter", status: "active", connected: true, captures: 0 },
      { u: "c", username: "Nyx", avatar: "shard:violet", team: team === "hunter" ? "fugitive" : "hunter", status: "captured", connected: true, captures: 0 },
      { u: "d", username: "Sol", avatar: "ring:gold", team: team === "hunter" ? "fugitive" : "hunter", status: "active", connected: false, captures: 0 },
    ],
    allies: [
      { u: "me", x: me.x, y: me.y, team, status: "active", ghost_until: null, boost_until: null, jam_until: null },
      { u: "a", x: me.x + 2, y: me.y - 3, team, status: "active", ghost_until: null, boost_until: null, jam_until: null },
    ],
    visible: [{ u: "b", x: me.x + 1, y: me.y + 2 }],
    effects: [{ id: "e", kind: "blocked", x: me.x - 1, y: me.y, expires_at: now + 30_000 }],
    cooldowns: { scan: { last_used_at: now - 20_000, uses: 1, until: null } },
    radar: {
      i: 3, kind: "auto", precision: "sector", origin: me, by: null, at: now - 1000, expires_at: now + 60_000,
      contacts: [{ sx: 2, sy: 0, size: 6, cols: 4 }, { jammed: true }],
    },
    reveals: [],
    streams: { all: 0, team: 0, p: 0 },
    events: [
      { s: "all", sn: 1, t: "phase_changed", d: { phase: "running" }, at: now - 140_000 },
      { s: "all", sn: 2, t: "capture", d: { h: "me", f: "c", x: 3, y: 3 }, at: now - 60_000 },
      { s: "hunter", sn: 1, t: "radar", d: { contacts: [{ sx: 2, sy: 0, size: 6, cols: 4 }, { jammed: true }] }, at: now - 1000 },
    ],
    final: null,
  };
}

export default function DevPreview() {
  const [team, setTeam] = useState<Team>("hunter");
  // eslint-disable-next-line react-hooks/purity
  const state = useMemo(() => fromView(demoView(team)), [team]);
  const now = state.view.server_now;
  const reach = useMemo(() => reachable(state.game.map, state.me, 2), [state]);
  if (process.env.NODE_ENV !== "development") return <p className="p-6 text-fog">Aperçu disponible uniquement en développement.</p>;
  return (
    <div className="fixed inset-0 flex flex-col bg-abyss">
      <header className="flex h-16 items-center justify-between px-3">
        <button className="text-sm text-fog" onClick={() => setTeam((t) => (t === "hunter" ? "fugitive" : "hunter"))}>
          Données fictives · basculer d&apos;équipe
        </button>
        <div className="flex flex-col items-center leading-none">
          <span className="num text-[28px]">{formatClock(512_000)}</span>
          <span className="mt-1 text-[11px] text-fog">Traque en cours</span>
        </div>
        <span className="w-24" />
      </header>
      <div className="relative flex min-h-0 flex-1 lg:grid lg:grid-cols-[300px_1fr_320px]">
        <aside className="hidden overflow-y-auto bg-graphite p-4 lg:block">
          <PlayersPanel state={state} online={new Set(["me", "a", "b"])} hostId="me" />
          <div className="mt-6">
            <RadarPanel state={state} now={now} />
          </div>
        </aside>
        <div className="relative min-h-0 flex-1">
          <GameMap state={state} now={now} reachable={reach} path={null} target={null} hover={null} showCoordinates={false} onCellTap={() => {}} />
        </div>
        <aside className="hidden overflow-y-auto bg-graphite p-4 lg:block">
          <JournalPanel state={state} />
        </aside>
      </div>
      <footer className="bg-graphite px-3 pb-3 pt-2.5">
        <div className="mx-auto max-w-3xl space-y-2.5">
          <StepsMeter state={state} now={now} />
          <ActionBar state={state} now={now} pending={null} targeting={null} onCapture={() => {}} onRadar={() => {}} onAbility={() => {}} />
        </div>
      </footer>
    </div>
  );
}
