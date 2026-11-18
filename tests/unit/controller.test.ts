/** Synchronisation client : doublons, trous de séquence, resynchronisation, erreurs. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameController, type GameApi } from "@/lib/game/controller";
import { DEFAULT_CONFIG } from "@/lib/engine/config";
import type { GameView } from "@/lib/game/state";
import { AppError } from "@/lib/errors";

function view(seqAll = 5): GameView {
  return {
    server_now: Date.now(),
    game: {
      id: "g", room_id: "r", mode: "classic", phase: "running", config: DEFAULT_CONFIG,
      map: { w: 4, h: 4, rows: ["....", "....", "....", "...."] },
      started_at: 0, running_at: 0, phase_started_at: 0, phase_ends_at: Date.now() + 60_000, paused_from: null,
      paused_remaining_ms: null, next_radar_at: null, ended_at: null, winner: null, end_reason: null, radar_state: {},
    },
    room: { id: "r", code: "ABCDEF", name: "S", host_id: "me" },
    me: { u: "me", team: "fugitive", initial_team: "fugitive", status: "active", x: 0, y: 0, steps: 3, steps_at: 0,
          ghost_until: null, jam_until: null, boost_until: null, last_capture_at: null, captures: 0 },
    players: [{ u: "me", username: "Moi", avatar: "orbit:azure", team: "fugitive", status: "active", connected: true, captures: 0 }],
    allies: [{ u: "me", x: 0, y: 0, team: "fugitive", status: "active", ghost_until: null, boost_until: null, jam_until: null }],
    visible: [], effects: [], cooldowns: {}, radar: null, reveals: [],
    streams: { all: seqAll, team: 0, p: 0 }, events: [], final: null,
  };
}

function mockApi(): GameApi & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  return {
    calls,
    gameView: vi.fn(async () => (count("gameView"), view(5))),
    serverTime: vi.fn(async () => Date.now()),
    tick: vi.fn(async () => count("tick")),
    heartbeat: vi.fn(async () => ({ server_now: Date.now() })),
    move: vi.fn(async (_id, path) => ({ x: path.at(-1)![0], y: path.at(-1)![1], steps: 2, steps_at: 0, server_now: Date.now() })),
    capture: vi.fn(async () => ({ captured: [], cooldown_until: 0, server_now: 0 })),
    radar: vi.fn(async () => ({ at: 0, uses: 1 })),
    ability: vi.fn(async () => {
      throw new AppError("E_COOLDOWN");
    }),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    leaveGame: vi.fn(async () => {}),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("GameController", () => {
  it("charge l'état, applique les événements en ordre et ignore les doublons", async () => {
    const api = mockApi();
    const c = new GameController("g", api);
    await c.load();
    const ev = (sn: number, phase: string) => ({ s: "all", sn, t: "phase_changed", d: { phase, phase_ends_at: 1 }, at: 1 });
    c.handleEvent(ev(6, "paused"));
    expect(c.state!.game.phase).toBe("paused");
    c.handleEvent(ev(6, "running")); // doublon
    c.handleEvent(ev(4, "running")); // en retard
    expect(c.state!.game.phase).toBe("paused");
  });

  it("met en attente un message en avance puis resynchronise si le trou persiste", async () => {
    const api = mockApi();
    const c = new GameController("g", api);
    await c.load();
    expect(api.calls.gameView).toBe(1);
    c.handleEvent({ s: "all", sn: 8, t: "capture", d: { h: "x", f: "y" }, at: 1 });
    await vi.advanceTimersByTimeAsync(1600);
    expect(api.calls.gameView).toBe(2);
  });

  it("comble un trou sans resynchroniser quand le message manquant arrive", async () => {
    const api = mockApi();
    const c = new GameController("g", api);
    await c.load();
    c.handleEvent({ s: "all", sn: 7, t: "map_effect", d: { id: "b", kind: "blocked", x: 1, y: 1, expires_at: Date.now() + 9e5 }, at: 1 });
    c.handleEvent({ s: "all", sn: 6, t: "map_effect", d: { id: "a", kind: "blocked", x: 2, y: 2, expires_at: Date.now() + 9e5 }, at: 1 });
    expect(c.state!.effects.map((e) => e.id)).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.calls.gameView).toBe(1);
  });

  it("met en tampon les événements reçus pendant le chargement", async () => {
    const api = mockApi();
    const c = new GameController("g", api);
    const p = c.load();
    c.handleEvent({ s: "all", sn: 6, t: "map_effect", d: { id: "z", kind: "blocked", x: 1, y: 1, expires_at: Date.now() + 9e5 }, at: 1 });
    await p;
    expect(c.state!.effects.map((e) => e.id)).toEqual(["z"]);
  });

  it("applique le résultat d'un déplacement et remonte les erreurs serveur", async () => {
    const api = mockApi();
    const c = new GameController("g", api);
    await c.load();
    expect(await c.move([{ x: 1, y: 0 }, { x: 2, y: 0 }])).toBe(true);
    expect([c.state!.me.x, c.state!.me.steps]).toEqual([2, 2]);
    const errors: string[] = [];
    c.setCallbacks(null, (e) => errors.push(e.code));
    expect(await c.ability("ghost", null)).toBe(false);
    expect(errors).toEqual(["E_COOLDOWN"]);
    expect(c.getSnapshot().pending).toBeNull();
  });

  it("calcule la prochaine échéance serveur", async () => {
    const api = mockApi();
    const c = new GameController("g", api);
    await c.load();
    expect(c.nextDeadline()).toBe(c.state!.game.phase_ends_at);
  });
});
