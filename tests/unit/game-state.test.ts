/** État de partie GPS, couches cartographiques et contrôleur (avec API simulée). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppError,
  DEFAULT_CONFIG,
  GameController,
  applyEvent,
  fromView,
  playerLayers,
  pruneExpired,
  radarLayers,
  streamsFor,
  zoneLayers,
  type GameApi,
  type GameView,
} from "@shared";

const ZONE = { lat: 48.8556, lng: 2.2986, radius_m: 500, label: "Test", set: true };

function view(): GameView {
  const now = Date.now();
  return {
    server_now: now,
    game: {
      id: "g", room_id: "r", mode: "classic", phase: "running", config: { ...DEFAULT_CONFIG, zone: ZONE }, zone: ZONE,
      started_at: 0, running_at: 0, phase_started_at: 0, phase_ends_at: now + 600_000, paused_from: null,
      paused_remaining_ms: null, next_radar_at: now + 60_000, ended_at: null, winner: null, end_reason: null, radar_state: {},
    },
    room: { id: "r", code: "ABCDEF", name: "S", host_id: "h1" },
    me: { u: "h1", team: "hunter", initial_team: "hunter", status: "active", lat: ZONE.lat, lng: ZONE.lng, acc: 8, pos_at: now,
          out_of_zone_since: null, ghost_until: null, jam_until: null, decoy_until: null, last_capture_at: null, captures: 0, distance_m: 0 },
    players: [
      { u: "h1", username: "Hugo", avatar: "orbit:azure", team: "hunter", status: "active", connected: true, captures: 0, out_of_zone: false },
      { u: "h2", username: "Iris", avatar: "orbit:azure", team: "hunter", status: "active", connected: true, captures: 0, out_of_zone: false },
      { u: "f1", username: "Lou", avatar: "orbit:azure", team: "fugitive", status: "active", connected: true, captures: 0, out_of_zone: false },
    ],
    allies: [{ u: "h2", lat: 48.856, lng: 2.299, acc: 10, at: now }],
    enemies: [{ u: "f1", lat: 48.857, lng: 2.3, acc: 30, at: now - 120_000 }],
    cooldowns: {}, radar: null, reveals: [],
    streams: { all: 5, team: 7, p: 1 }, events: [], final: null,
  };
}

describe("état de partie GPS", () => {
  it("positions alliées/adverses, retrait, sortie de zone et capture", () => {
    let s = fromView(view());
    expect(streamsFor(s.view)).toEqual({ all: 5, hunter: 7, "p:h1": 1 });
    s = applyEvent(s, { s: "fugitive", sn: 1, t: "enemy_pos", d: { u: "f1", lat: 48.858, lng: 2.3, acc: 30, at: 5 }, at: 5 });
    expect(s.enemies.f1.lat).toBe(48.858);
    s = applyEvent(s, { s: "all", sn: 6, t: "zone_status", d: { u: "f1", out: true, at: 6 }, at: 6 });
    expect(s.players.f1.out_of_zone).toBe(true);
    s = applyEvent(s, { s: "all", sn: 7, t: "capture", d: { h: "h1", f: "f1" }, at: 7 });
    expect(s.players.f1.status).toBe("captured");
    expect(s.enemies.f1).toBeUndefined();
    expect(s.me.captures).toBe(1);
    s = applyEvent(s, { s: "all", sn: 8, t: "position_withdrawn", d: { u: "h2" }, at: 8 });
    expect(s.allies.h2).toBeUndefined();
  });

  it("ma propre position diffusée par l'équipe n'écrase pas celle de l'appareil", () => {
    let s = fromView(view());
    s = applyEvent(s, { s: "hunter", sn: 8, t: "pos", d: { u: "h1", lat: 1, lng: 1, at: 1 }, at: 1 });
    expect(s.allies.h1).toBeUndefined();
  });

  it("une infection impose une resynchronisation côté Fugitifs", () => {
    const v = view();
    v.me = { ...v.me, u: "f1", team: "fugitive", initial_team: "fugitive" };
    let s = fromView(v);
    s = applyEvent(s, { s: "all", sn: 6, t: "capture", d: { h: "h1", f: "f2", infected: true }, at: 1 });
    expect(s.needsResync).toBe(true);
  });

  it("purge radar et indices expirés", () => {
    let s = fromView(view());
    s = applyEvent(s, { s: "hunter", sn: 8, t: "radar", at: 1, d: { i: 1, kind: "auto", precision: "direction", contacts: [], origin: null, by: null, at: 1, expires_at: 100 } });
    expect(pruneExpired(s, 50)).toBe(s);
    expect(pruneExpired(s, 150).radar).toBeNull();
  });
});

describe("couches cartographiques", () => {
  it("grise les positions obsolètes et n'affiche pas les joueurs masqués", () => {
    let s = fromView(view());
    const now = Date.now();
    const { points, accuracy } = playerLayers(s, now);
    const kinds = points.features.map((f) => [f.properties.kind, f.properties.stale]);
    expect(kinds).toContainEqual(["ally", false]);
    expect(kinds).toContainEqual(["enemy", true]); // vue il y a 2 min > 45 s
    expect(kinds).toContainEqual(["me", false]);
    expect(accuracy.features.length).toBeGreaterThanOrEqual(2);
    s = applyEvent(s, { s: "hunter", sn: 8, t: "enemy_pos", d: { u: "f1", hidden: true, at: now }, at: now });
    expect(playerLayers(s, now).points.features.some((f) => f.properties.kind === "enemy")).toBe(false);
  });

  it("dessine zone, caps radar et secteurs", () => {
    expect(zoneLayers(ZONE).mask.features[0].geometry.type).toBe("Polygon");
    let s = fromView(view());
    const now = Date.now();
    s = applyEvent(s, {
      s: "hunter", sn: 8, t: "radar", at: now,
      d: { i: 1, kind: "auto", precision: "direction", origin: { lat: ZONE.lat, lng: ZONE.lng }, by: null, at: now, expires_at: now + 10_000,
           contacts: [{ dir: "N", band: "mid", dist_m: 250 }, { sector: 2, ring: 1 }, { lat: ZONE.lat, lng: ZONE.lng, r_m: 120 }, { jammed: true }] },
    });
    const r = radarLayers(s, now);
    expect(r.bearings.features).toHaveLength(1);
    expect(r.areas.features).toHaveLength(2);
  });
});

describe("contrôleur", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function api(): GameApi & { sent: number[] } {
    const sent: number[] = [];
    return {
      sent,
      gameView: vi.fn(async () => ({ ...view(), server_now: Date.now() + 60_000 })),
      serverTime: vi.fn(async () => Date.now() + 60_000),
      tick: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({ server_now: Date.now() })),
      reportPosition: vi.fn(async (_id, fix) => {
        sent.push(fix.timestamp);
        await new Promise((r) => setTimeout(r, 100));
        return { accepted: true, server_now: Date.now() };
      }),
      capture: vi.fn(async () => ({ captured: [], cooldown_until: 0, server_now: 0 })),
      radar: vi.fn(async () => ({ at: 0, uses: 1 })),
      ability: vi.fn(async () => {
        throw new AppError("E_POSITION_REQUIRED");
      }),
      pause: vi.fn(async () => {}),
      resume: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      leaveGame: vi.fn(async () => {}),
      safetyStop: vi.fn(async () => {}),
    };
  }

  it("n'envoie que la position la plus récente, recalée sur l'horloge serveur", async () => {
    const a = api();
    const c = new GameController("g", a);
    await c.load();
    await c.syncClock(1);
    const fix = (t: number) => ({ lat: ZONE.lat, lng: ZONE.lng, accuracy: 5, timestamp: t });
    c.submitFix(fix(1000));
    c.submitFix(fix(2000)); // pendant l'envoi
    c.submitFix(fix(3000)); // remplace la précédente
    await vi.advanceTimersByTimeAsync(500);
    expect(a.sent).toHaveLength(1); // la suivante attend l'intervalle de la partie
    await vi.advanceTimersByTimeAsync(c.sendIntervalMs());
    expect(a.sent).toHaveLength(2);
    expect(a.sent[1] - 3000).toBeGreaterThan(59_000); // décalage serveur appliqué
    expect(c.getSnapshot().uplink.status).toBe("ok");
    expect(c.state!.device!.timestamp).toBe(3000);
  });

  it("limite les envois à un par intervalle même si le GPS émet en rafale (iOS, double flux)", async () => {
    const a = api();
    const c = new GameController("g", a);
    await c.load();
    const interval = c.sendIntervalMs();
    expect(interval).toBeGreaterThanOrEqual(3000);
    // 1 mesure toutes les 500 ms pendant 30 s, en double (premier plan + arrière-plan).
    for (let t = 0; t < 30_000; t += 500) {
      c.submitFix({ lat: ZONE.lat, lng: ZONE.lng, accuracy: 5, timestamp: t });
      c.submitFix({ lat: ZONE.lat, lng: ZONE.lng, accuracy: 5, timestamp: t });
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(interval);
    expect(a.sent.length).toBeLessThanOrEqual(Math.ceil(30_000 / interval) + 1);
    expect(a.sent.length).toBeGreaterThanOrEqual(Math.floor(30_000 / interval));
    // La dernière mesure finit toujours par partir (jamais perdue).
    expect(a.sent[a.sent.length - 1] - c.clock.offset).toBeCloseTo(29_500, -1);
    c.dispose();
  });

  it("arrête d'envoyer quand la partie est finie et remonte les erreurs", async () => {
    const a = api();
    const c = new GameController("g", a);
    await c.load();
    const errors: string[] = [];
    c.setCallbacks(null, (e) => errors.push(e.code));
    expect(await c.ability("scan")).toBe(false);
    expect(errors).toEqual(["E_POSITION_REQUIRED"]);
    c.handleEvent({ s: "all", sn: 6, t: "game_finished", d: { winner: "hunter", reason: "all_captured", players: [] }, at: 1 });
    expect(c.shouldTrack()).toBe(false);
    c.submitFix({ lat: 1, lng: 1, accuracy: 5, timestamp: 1 });
    await vi.advanceTimersByTimeAsync(200);
    expect(a.sent).toHaveLength(0);
  });

  it("détecte un trou de séquence et resynchronise", async () => {
    const a = api();
    const c = new GameController("g", a);
    await c.load();
    c.handleEvent({ s: "all", sn: 9, t: "radar_ping", d: { at: 1 }, at: 1 });
    await vi.advanceTimersByTimeAsync(1600);
    expect(a.gameView).toHaveBeenCalledTimes(2);
  });
});
