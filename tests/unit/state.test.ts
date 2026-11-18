import { describe, expect, it } from "vitest";
import { applyEvent, fromView, pruneExpired, streamsFor, type GameView } from "@/lib/game/state";
import { DEFAULT_CONFIG } from "@/lib/engine/config";

function view(): GameView {
  return {
    server_now: 1000,
    game: {
      id: "g", room_id: "r", mode: "classic", phase: "running", config: DEFAULT_CONFIG,
      map: { w: 4, h: 4, rows: ["....", "....", "....", "...."] },
      started_at: 0, running_at: 0, phase_started_at: 0, phase_ends_at: 900_000, paused_from: null,
      paused_remaining_ms: null, next_radar_at: 60_000, ended_at: null, winner: null, end_reason: null, radar_state: {},
    },
    room: { id: "r", code: "ABCDEF", name: "Salon", host_id: "h1" },
    me: { u: "h1", team: "hunter", initial_team: "hunter", status: "active", x: 0, y: 0, steps: 4, steps_at: 0,
          ghost_until: null, jam_until: null, boost_until: null, last_capture_at: null, captures: 0 },
    players: [
      { u: "h1", username: "Hugo", avatar: "orbit:azure", team: "hunter", status: "active", connected: true, captures: 0 },
      { u: "h2", username: "Iris", avatar: "orbit:azure", team: "hunter", status: "active", connected: true, captures: 0 },
      { u: "f1", username: "Lou", avatar: "orbit:azure", team: "fugitive", status: "active", connected: true, captures: 0 },
    ],
    allies: [
      { u: "h1", x: 0, y: 0, team: "hunter", status: "active", ghost_until: null, boost_until: null, jam_until: null },
      { u: "h2", x: 1, y: 0, team: "hunter", status: "active", ghost_until: null, boost_until: null, jam_until: null },
    ],
    visible: [{ u: "f1", x: 2, y: 2 }],
    effects: [], cooldowns: {}, radar: null, reveals: [],
    streams: { all: 5, team: 7, p: 1 }, events: [], final: null,
  };
}

describe("état de partie", () => {
  it("initialise les positions de flux pour le séquenceur", () => {
    expect(streamsFor(view())).toEqual({ all: 5, hunter: 7, "p:h1": 1 });
  });

  it("applique déplacements d'alliés et visibilité", () => {
    let s = fromView(view());
    s = applyEvent(s, { s: "hunter", sn: 8, t: "move", d: { u: "h2", x: 2, y: 0, p: [[2, 0]] }, at: 1 });
    expect(s.allies.h2).toMatchObject({ x: 2, y: 0 });
    expect(s.trails.h2).toEqual([{ x: 2, y: 0 }]);
    s = applyEvent(s, { s: "hunter", sn: 9, t: "vis", d: { enemies: [] }, at: 2 });
    expect(s.visible).toEqual([]);
    expect(s.journal).toHaveLength(0); // move/vis n'encombrent pas le journal
  });

  it("applique une capture et la fin de partie avec révélation complète", () => {
    let s = fromView(view());
    s = applyEvent(s, { s: "all", sn: 6, t: "capture", d: { h: "h1", f: "f1", x: 1, y: 1 }, at: 3 });
    expect(s.players.f1.status).toBe("captured");
    expect(s.players.h1.captures).toBe(1);
    expect(s.me.captures).toBe(1);
    expect(s.visible).toHaveLength(0);
    s = applyEvent(s, {
      s: "all", sn: 7, t: "game_finished", at: 4,
      d: { winner: "hunter", reason: "all_captured", ended_at: 4,
           players: [{ u: "f1", team: "fugitive", initial_team: "fugitive", status: "captured", outcome: "loss", score: 10, captures: 0, survival_seconds: 10, x: 1, y: 1 }] },
    });
    expect(s.game.phase).toBe("finished");
    expect(s.allies.f1).toMatchObject({ x: 1, y: 1 });
    expect(s.final).toHaveLength(1);
  });

  it("demande une resynchronisation après changement d'équipe ou reprise", () => {
    let s = fromView(view());
    s = applyEvent(s, { s: "p:h1", sn: 2, t: "team_changed", d: { team: "hunter" }, at: 1 });
    expect(s.needsResync).toBe(true);
    let p = fromView({ ...view(), game: { ...view().game, phase: "paused" } });
    p = applyEvent(p, { s: "all", sn: 6, t: "phase_changed", d: { phase: "running", phase_ends_at: 1 }, at: 1 });
    expect(p.needsResync).toBe(true);
  });

  it("purge radar, révélations et effets expirés", () => {
    let s = fromView(view());
    s = applyEvent(s, { s: "hunter", sn: 8, t: "radar", at: 1, d: { i: 1, kind: "auto", precision: "sector", contacts: [], origin: { x: 0, y: 0 }, by: null, at: 1, expires_at: 100 } });
    s = applyEvent(s, { s: "all", sn: 6, t: "map_effect", at: 1, d: { id: "e", kind: "blocked", x: 1, y: 1, expires_at: 200 } });
    expect(pruneExpired(s, 50)).toBe(s);
    const p = pruneExpired(s, 150);
    expect(p.radar).toBeNull();
    expect(p.effects).toHaveLength(1);
    expect(pruneExpired(s, 250).effects).toHaveLength(0);
  });
});
