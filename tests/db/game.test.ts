import { describe, expect, it } from "vitest";
import { TestDb, expectRpcError } from "./harness";
import { gamePhase, keepAlive, place, playerRow, setupGame, skipPreparation } from "./fixtures";

type Json = Record<string, any>;

function bfsReachable(rows: string[]): { open: number; reached: number } {
  const h = rows.length, w = rows[0].length;
  let start = -1, open = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === ".") { open++; if (start < 0) start = y * w + x; }
  const seen = new Set<number>([start]);
  const q = [start];
  while (q.length) {
    const c = q.shift()!;
    const cx = c % w, cy = Math.floor(c / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || rows[ny][nx] !== ".") continue;
      const k = ny * w + nx;
      if (!seen.has(k)) { seen.add(k); q.push(k); }
    }
  }
  return { open, reached: seen.size };
}

describe("génération de carte", () => {
  it("produit une carte connexe, déterministe et de la bonne taille", async () => {
    const db = await TestDb.create();
    for (const size of ["s", "m", "l"]) {
      for (const seed of [1, 42, 99999]) {
        const [{ map }] = await db.sql<{ map: { w: number; h: number; rows: string[] } }>(
          `select private.generate_map($1, 0.2, true, $2) as map`, [size, seed]);
        const [{ map: again }] = await db.sql<{ map: unknown }>(
          `select private.generate_map($1, 0.2, true, $2) as map`, [size, seed]);
        expect(again).toEqual(map);
        expect(map.rows).toHaveLength(map.h);
        expect(map.w).toBe({ s: 16, m: 22, l: 30 }[size]);
        const { open, reached } = bfsReachable(map.rows);
        expect(reached).toBe(open);
        expect(open / (map.w * map.h)).toBeGreaterThan(0.5);
        expect(map.rows.join("")).toMatch(/~/);
      }
    }
  });
});

describe("démarrage et préparation", () => {
  it("place les joueurs sur des cases libres, Fugitifs éloignés de la base", async () => {
    const f = await setupGame({ hunters: 3, fugitives: 8, openMap: false });
    const [{ map }] = await f.db.sql<{ map: { rows: string[]; w: number } }>(`select map from public.games where id = $1`, [f.gameId]);
    const ps = await f.db.sql<{ x: number; y: number; team: string }>(`select * from public.player_states where game_id = $1`, [f.gameId]);
    expect(ps).toHaveLength(11);
    for (const p of ps) expect(map.rows[p.y][p.x]).toBe(".");
    const fug = ps.filter((p) => p.team === "fugitive");
    expect(new Set(fug.map((p) => `${p.x},${p.y}`)).size).toBe(fug.length);
    const hun = ps.filter((p) => p.team === "hunter");
    const hx = hun.reduce((s, p) => s + p.x, 0) / hun.length, hy = hun.reduce((s, p) => s + p.y, 0) / hun.length;
    const minDist = Math.min(...fug.map((p) => Math.hypot(p.x - hx, p.y - hy)));
    expect(minDist).toBeGreaterThan(5);
    expect(await gamePhase(f.db, f.gameId)).toBe("preparation");
    const room = await f.db.sql<{ status: string }>(`select status from public.rooms where id = $1`, [f.roomId]);
    expect(room[0].status).toBe("playing");
  });

  it("gèle les Chasseurs et les rend aveugles pendant la préparation", async () => {
    const f = await setupGame();
    const [h] = f.hunters, [fu] = f.fugitives;
    await place(f.db, f.gameId, h, 5, 5);
    await place(f.db, f.gameId, fu, 6, 5);
    await expectRpcError(f.db.as(h).rpc("move", { p_game: f.gameId, p_path: [[5, 6]] }), "E_CANNOT_MOVE_NOW");
    const res = await f.db.as(fu).rpc<Json>("move", { p_game: f.gameId, p_path: [[7, 5]] });
    expect(res.x).toBe(7);
    const view = await f.db.as(h).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(view.visible).toEqual([]);
    // Le fugitif, lui, voit le chasseur adjacent.
    const fview = await f.db.as(fu).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(fview.visible.map((v: Json) => v.u)).toContain(h.id);
  });

  it("passe en partie à la fin de la préparation (tick idempotent)", async () => {
    const f = await setupGame({ config: { prep_s: 30, duration_s: 300 } });
    await f.db.advance(29_000);
    await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
    expect(await gamePhase(f.db, f.gameId)).toBe("preparation");
    await f.db.advance(2_000);
    await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
    await f.db.as(f.fugitives[0]).rpc("game_tick", { p_game: f.gameId });
    expect(await gamePhase(f.db, f.gameId)).toBe("running");
    const changes = (await f.db.broadcasts(`game:${f.gameId}:all`)).filter((m) => m.payload.t === "phase_changed");
    expect(changes.map((m) => (m.payload.d as Json).phase)).toEqual(["preparation", "running"]);
  });
});

describe("déplacements", () => {
  it("valide chemin, obstacles, bornes et pas disponibles", async () => {
    const f = await setupGame({ config: { max_steps: 3, step_regen_ms: 2000 } });
    await skipPreparation(f);
    const h = f.hunters[0];
    await place(f.db, f.gameId, h, 2, 2);
    await f.db.sql(`update public.player_states set steps = 3, steps_at = private.now_() where game_id = $1`, [f.gameId]);
    const mv = (path: number[][]) => f.db.as(h).rpc<Json>("move", { p_game: f.gameId, p_path: path });

    await expectRpcError(mv([[4, 2]]), "E_INVALID_PATH"); // saut
    await expectRpcError(mv([[3, 3]]), "E_INVALID_PATH"); // diagonale
    await expectRpcError(mv([]), "E_INVALID_PATH");
    await expectRpcError(f.db.as(h).rpc("move", { p_game: f.gameId, p_path: { x: 1 } }), "E_INVALID_PATH");
    await expectRpcError(mv([[3, 2], [4, 2], [5, 2], [6, 2]]), "E_NOT_ENOUGH_STEPS");

    // Obstacle
    const rows = Array.from({ length: 22 }, () => ".".repeat(22).split(""));
    rows[2][3] = "#";
    await f.db.sql(`update public.games set map = $2 where id = $1`, [
      f.gameId, JSON.stringify({ w: 22, h: 22, rows: rows.map((r) => r.join("")) })]);
    await expectRpcError(mv([[3, 2]]), "E_BLOCKED");
    await expectRpcError(mv([[1, 2], [0, 2], [-1, 2]]), "E_BLOCKED"); // hors carte

    const r = await mv([[2, 3], [3, 3], [4, 3]]);
    expect([r.x, r.y, r.steps]).toEqual([4, 3, 0]);
    await expectRpcError(mv([[5, 3]]), "E_NOT_ENOUGH_STEPS");

    // Régénération : 1 pas toutes les 2 s, plafonnée à max_steps
    await f.db.advance(4100);
    const r2 = await mv([[5, 3], [6, 3]]);
    expect(r2.steps).toBe(0);
    await f.db.advance(60_000);
    await keepAlive(f.db, f.gameId);
    const view = await f.db.as(h).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(view.me.steps).toBe(3);
  });

  it("diffuse un déplacement uniquement à l'équipe du joueur", async () => {
    const f = await setupGame();
    await skipPreparation(f);
    const [fu] = f.fugitives;
    await place(f.db, f.gameId, f.hunters[0], 0, 0);
    await place(f.db, f.gameId, fu, 15, 15);
    await f.db.clearBroadcasts();
    await f.db.as(fu).rpc("move", { p_game: f.gameId, p_path: [[15, 16]] });
    const fugMsgs = await f.db.broadcasts(`game:${f.gameId}:fugitive`);
    expect(fugMsgs.find((m) => m.payload.t === "move")).toBeTruthy();
    const hunterMsgs = await f.db.broadcasts(`game:${f.gameId}:hunter`);
    const allMsgs = await f.db.broadcasts(`game:${f.gameId}:all`);
    expect(JSON.stringify([...hunterMsgs, ...allMsgs])).not.toContain('"x":15');
  });

  it("met à jour la visibilité quand un adversaire entre dans le rayon de vision", async () => {
    const f = await setupGame({ config: { vision_hunter: 2 } });
    await skipPreparation(f);
    const [h] = f.hunters, [fu] = f.fugitives;
    await place(f.db, f.gameId, h, 5, 5);
    await place(f.db, f.gameId, fu, 5, 9);
    await f.db.clearBroadcasts();
    await f.db.as(fu).rpc("move", { p_game: f.gameId, p_path: [[5, 8], [5, 7]] });
    const vis = (await f.db.broadcasts(`game:${f.gameId}:hunter`)).filter((m) => m.payload.t === "vis");
    expect(vis).toHaveLength(1);
    expect((vis[0].payload.d as Json).enemies).toEqual([{ u: fu.id, x: 5, y: 7 }]);
  });
});

describe("captures et victoire", () => {
  it("capture à portée, applique le temps de recharge, et termine la partie", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { capture_range: 1, capture_cooldown_s: 5 } });
    await skipPreparation(f);
    const [h] = f.hunters, [f1, f2] = f.fugitives;
    await place(f.db, f.gameId, h, 5, 5);
    await place(f.db, f.gameId, f1, 6, 6);
    await place(f.db, f.gameId, f2, 12, 12);

    await expectRpcError(f.db.as(f1).rpc("attempt_capture", { p_game: f.gameId }), "E_WRONG_TEAM");
    const r = await f.db.as(h).rpc<Json>("attempt_capture", { p_game: f.gameId });
    expect(r.captured).toEqual([f1.id]);
    expect((await playerRow(f.db, f.gameId, f1)).status).toBe("captured");
    await expectRpcError(f.db.as(h).rpc("attempt_capture", { p_game: f.gameId }), "E_COOLDOWN");
    await expectRpcError(f.db.as(f1).rpc("move", { p_game: f.gameId, p_path: [[6, 7]] }), "E_NOT_ACTIVE");

    await f.db.advance(5_100);
    await keepAlive(f.db, f.gameId);
    const miss = await f.db.as(h).rpc<Json>("attempt_capture", { p_game: f.gameId });
    expect(miss.captured).toEqual([]);

    await f.db.advance(5_100);
    await keepAlive(f.db, f.gameId);
    await place(f.db, f.gameId, f2, 5, 4);
    await f.db.as(h).rpc("attempt_capture", { p_game: f.gameId });

    const [g] = await f.db.sql<Json>(`select * from public.games where id = $1`, [f.gameId]);
    expect(g.phase).toBe("finished");
    expect(g.winner).toBe("hunter");
    expect(g.end_reason).toBe("all_captured");

    const stats = await f.db.sql<Json>(`select * from public.game_statistics where game_id = $1`, [f.gameId]);
    expect(stats).toHaveLength(3);
    const hs = stats.find((s) => s.user_id === h.id)!;
    expect(hs.outcome).toBe("win");
    expect(hs.captures).toBe(2);
    expect(hs.score).toBe(400);
    const [prof] = await f.db.sql<Json>(`select * from public.profiles where id = $1`, [h.id]);
    expect([prof.games_played, prof.wins, prof.captures]).toEqual([1, 1, 2]);
    const [pf] = await f.db.sql<Json>(`select * from public.profiles where id = $1`, [f1.id]);
    expect([pf.losses, pf.times_captured]).toEqual([1, 1]);
    const room = await f.db.sql<Json>(`select status from public.rooms where id = $1`, [f.roomId]);
    expect(room[0].status).toBe("results");

    // Retour au lobby
    await f.db.as(f.host).rpc("return_to_lobby", { p_room: f.roomId });
    const room2 = await f.db.sql<Json>(`select status, current_game_id from public.rooms where id = $1`, [f.roomId]);
    expect(room2[0]).toEqual({ status: "lobby", current_game_id: null });
  });

  it("donne la victoire aux Fugitifs à la fin du temps", async () => {
    const f = await setupGame({ config: { duration_s: 120 } });
    await skipPreparation(f);
    await f.db.advance(121_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
    const [g] = await f.db.sql<Json>(`select winner, end_reason from public.games where id = $1`, [f.gameId]);
    expect(g).toEqual({ winner: "fugitive", end_reason: "time_up" });
    const stats = await f.db.sql<Json>(`select * from public.game_statistics where game_id = $1 and team = 'fugitive'`, [f.gameId]);
    for (const s of stats) {
      expect(s.outcome).toBe("win");
      expect(s.survival_seconds).toBe(121);
      expect(s.score).toBe(121 + 300 + 100);
    }
  });

  it("gère l'abandon : départ de tous les Chasseurs", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2 });
    await skipPreparation(f);
    await f.db.as(f.hunters[0]).rpc("leave_game", { p_game: f.gameId });
    const [g] = await f.db.sql<Json>(`select winner, end_reason from public.games where id = $1`, [f.gameId]);
    expect(g).toEqual({ winner: "fugitive", end_reason: "hunters_left" });
    const [s] = await f.db.sql<Json>(`select outcome, score from public.game_statistics where user_id = $1`, [f.hunters[0].id]);
    expect(s).toEqual({ outcome: "loss", score: 0 });
  });

  it("marque déconnecté puis abandon après le délai de grâce", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { disconnect_grace_s: 60 } });
    await skipPreparation(f);
    await keepAlive(f.db, f.gameId);
    await f.db.advance(50_000);
    await f.db.as(f.hunters[0]).rpc("heartbeat", { p_game: f.gameId });
    await f.db.as(f.fugitives[0]).rpc("heartbeat", { p_game: f.gameId });
    expect((await playerRow(f.db, f.gameId, f.fugitives[1])).connected).toBe(false);
    expect((await playerRow(f.db, f.gameId, f.fugitives[1])).status).toBe("active");
    // Reconnexion avant la fin du délai : le joueur redevient connecté.
    await f.db.as(f.fugitives[1]).rpc("heartbeat", { p_game: f.gameId });
    expect((await playerRow(f.db, f.gameId, f.fugitives[1])).connected).toBe(true);
    await f.db.advance(61_000);
    await f.db.as(f.hunters[0]).rpc("heartbeat", { p_game: f.gameId });
    expect((await playerRow(f.db, f.gameId, f.fugitives[0])).status).toBe("abandoned");
    expect((await playerRow(f.db, f.gameId, f.fugitives[1])).status).toBe("abandoned");
    expect(await gamePhase(f.db, f.gameId)).toBe("finished");
  });

  it("interrompt une partie sans comptabiliser les statistiques", async () => {
    const f = await setupGame();
    await skipPreparation(f);
    await expectRpcError(f.db.as(f.fugitives[0]).rpc("abort_game", { p_game: f.gameId }), "E_NOT_HOST");
    await f.db.as(f.host).rpc("abort_game", { p_game: f.gameId });
    const [g] = await f.db.sql<Json>(`select winner, end_reason from public.games where id = $1`, [f.gameId]);
    expect(g).toEqual({ winner: "draw", end_reason: "aborted" });
    const [p] = await f.db.sql<Json>(`select games_played from public.profiles where id = $1`, [f.host.id]);
    expect(p.games_played).toBe(0);
  });

  it("mode Infection : un Fugitif capturé rejoint les Chasseurs", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { mode: "infection" } });
    await skipPreparation(f);
    const [h] = f.hunters, [f1, f2] = f.fugitives;
    await place(f.db, f.gameId, h, 5, 5);
    await place(f.db, f.gameId, f1, 5, 6);
    await place(f.db, f.gameId, f2, 15, 15);
    await f.db.as(h).rpc("attempt_capture", { p_game: f.gameId });
    const r1 = await playerRow(f.db, f.gameId, f1);
    expect([r1.team, r1.status, r1.initial_team]).toEqual(["hunter", "active", "fugitive"]);
    const personal = await f.db.broadcasts(`game:${f.gameId}:p:${f1.id}`);
    expect(personal.map((m) => m.payload.t)).toContain("team_changed");
    // L'infecté peut maintenant capturer.
    await place(f.db, f.gameId, f1, 15, 14);
    await f.db.as(f1).rpc("attempt_capture", { p_game: f.gameId });
    const [g] = await f.db.sql<Json>(`select winner from public.games where id = $1`, [f.gameId]);
    expect(g.winner).toBe("hunter");
    const st = await f.db.sql<Json>(`select outcome, captures from public.game_statistics where user_id = $1`, [f1.id]);
    expect(st[0]).toEqual({ outcome: "win", captures: 1 });
  });
});

describe("pause", () => {
  it("gèle le chronomètre et les actions, réservé à l'hôte", async () => {
    const f = await setupGame({ config: { duration_s: 300 } });
    await skipPreparation(f);
    const [before] = await f.db.sql<Json>(`select phase_ends_at from public.games where id = $1`, [f.gameId]);
    await f.db.advance(10_000);
    await expectRpcError(f.db.as(f.fugitives[0]).rpc("pause_game", { p_game: f.gameId }), "E_NOT_HOST");
    await f.db.as(f.host).rpc("pause_game", { p_game: f.gameId });
    expect(await gamePhase(f.db, f.gameId)).toBe("paused");
    await expectRpcError(f.db.as(f.fugitives[0]).rpc("move", { p_game: f.gameId, p_path: [[0, 0]] }), "E_CANNOT_MOVE_NOW");
    await expectRpcError(f.db.as(f.host).rpc("pause_game", { p_game: f.gameId }), "E_INVALID_TRANSITION");
    await f.db.advance(60_000);
    await f.db.as(f.host).rpc("resume_game", { p_game: f.gameId });
    const [after] = await f.db.sql<Json>(`select phase, phase_ends_at from public.games where id = $1`, [f.gameId]);
    expect(after.phase).toBe("running");
    expect(new Date(after.phase_ends_at).getTime() - new Date(before.phase_ends_at).getTime()).toBe(60_000);
  });
});

describe("radar", () => {
  it("émet des impulsions automatiques synchronisées sur l'horloge serveur, sans doublon", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 3, config: { radar: { interval_s: 30, precision: "sector", teams: "hunter" } } });
    await skipPreparation(f);
    await f.db.clearBroadcasts();
    await f.db.advance(29_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
    expect((await f.db.broadcasts(`game:${f.gameId}:hunter`)).filter((m) => m.payload.t === "radar")).toHaveLength(0);
    await f.db.advance(1_500);
    // Plusieurs clients déclenchent le tick simultanément : une seule impulsion.
    for (const u of [f.host, ...f.fugitives]) await f.db.as(u).rpc("game_tick", { p_game: f.gameId });
    const radar = (await f.db.broadcasts(`game:${f.gameId}:hunter`)).filter((m) => m.payload.t === "radar");
    expect(radar).toHaveLength(1);
    const d = radar[0].payload.d as Json;
    expect(d.precision).toBe("sector");
    expect(d.contacts).toHaveLength(3);
    for (const c of d.contacts) expect(Object.keys(c).sort()).toEqual(["cols", "size", "sx", "sy"]);
    // Les Fugitifs perçoivent l'impulsion sans en connaître le résultat.
    const ping = (await f.db.broadcasts(`game:${f.gameId}:fugitive`)).filter((m) => m.payload.t === "radar_ping");
    expect(ping).toHaveLength(1);
    // Rattrapage : après une longue absence de tick, une seule impulsion, pas une rafale.
    await f.db.advance(200_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
    const radar2 = (await f.db.broadcasts(`game:${f.gameId}:hunter`)).filter((m) => m.payload.t === "radar");
    expect(radar2).toHaveLength(2);
    const [g] = await f.db.sql<Json>(`select next_radar_at from public.games where id = $1`, [f.gameId]);
    expect(new Date(g.next_radar_at).getTime()).toBeGreaterThan(f.db.now().getTime());
  });

  it("calcule direction / zone sans révéler la position exacte, et respecte le Brouilleur", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { radar: { precision: "direction" } } });
    await skipPreparation(f);
    await place(f.db, f.gameId, f.hunters[0], 2, 2);
    await place(f.db, f.gameId, f.fugitives[0], 2, 18);
    await place(f.db, f.gameId, f.fugitives[1], 18, 18);
    await f.db.sql(`update public.player_states set jam_until = private.now_() + interval '1 minute' where user_id = $1`, [f.fugitives[1].id]);
    const [{ c }] = await f.db.sql<{ c: Json[] }>(`select private.radar_contacts($1, 'hunter', 'direction', 2, 2) c`, [f.gameId]);
    expect(c).toContainEqual({ dir: "S", band: "far" });
    expect(c).toContainEqual({ jammed: true });
    const [{ z }] = await f.db.sql<{ z: Json[] }>(`select private.radar_contacts($1, 'hunter', 'zone', 2, 2) z`, [f.gameId]);
    const zone = z.find((x) => !x.jammed)!;
    expect(2).toBeGreaterThanOrEqual(zone.x0);
    expect(2).toBeLessThan(zone.x0 + zone.size);
    expect(18).toBeGreaterThanOrEqual(zone.y0);
    expect(18).toBeLessThan(zone.y0 + zone.size);
  });

  it("radar manuel : équipe autorisée, temps de recharge, utilisations limitées", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 1, config: { radar: { mode: "manual", teams: "hunter", cooldown_s: 20, max_uses: 2 } } });
    await skipPreparation(f);
    const h = f.hunters[0];
    await expectRpcError(f.db.as(f.fugitives[0]).rpc("radar_activate", { p_game: f.gameId }), "E_WRONG_TEAM");
    const r = await f.db.as(h).rpc<Json>("radar_activate", { p_game: f.gameId });
    expect(r.kind).toBe("manual");
    await expectRpcError(f.db.as(h).rpc("radar_activate", { p_game: f.gameId }), "E_COOLDOWN");
    await f.db.advance(21_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(h).rpc("radar_activate", { p_game: f.gameId });
    await f.db.advance(21_000);
    await keepAlive(f.db, f.gameId);
    await expectRpcError(f.db.as(h).rpc("radar_activate", { p_game: f.gameId }), "E_NO_USES_LEFT");
    const pulses = await f.db.sql(`select * from public.radar_pulses where game_id = $1`, [f.gameId]);
    expect(pulses).toHaveLength(2);
  });
});

describe("capacités", () => {
  it("Fantôme masque le Fugitif, mais le Scan le révèle et l'alerte", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 1 });
    await skipPreparation(f);
    const [h] = f.hunters, [fu] = f.fugitives;
    await place(f.db, f.gameId, h, 5, 5);
    await place(f.db, f.gameId, fu, 6, 5);
    expect((await f.db.as(h).rpc<Json>("get_game_view", { p_game: f.gameId })).visible).toHaveLength(1);
    await expectRpcError(f.db.as(h).rpc("use_ability", { p_game: f.gameId, p_key: "ghost" }), "E_WRONG_TEAM");
    await f.db.as(fu).rpc("use_ability", { p_game: f.gameId, p_key: "ghost" });
    expect((await f.db.as(h).rpc<Json>("get_game_view", { p_game: f.gameId })).visible).toHaveLength(0);
    await expectRpcError(f.db.as(fu).rpc("use_ability", { p_game: f.gameId, p_key: "ghost" }), "E_COOLDOWN");

    await expectRpcError(f.db.as(h).rpc("use_ability", { p_game: f.gameId, p_key: "scan" }), "E_TARGET_REQUIRED");
    await expectRpcError(
      f.db.as(h).rpc("use_ability", { p_game: f.gameId, p_key: "scan", p_target: { x: 20, y: 20 } }), "E_OUT_OF_RANGE");
    const scan = await f.db.as(h).rpc<Json>("use_ability", { p_game: f.gameId, p_key: "scan", p_target: { x: 7, y: 5 } });
    expect(scan.result.contacts).toEqual([{ u: fu.id, x: 6, y: 5 }]);
    const alerts = (await f.db.broadcasts(`game:${f.gameId}:p:${fu.id}`)).filter((m) => m.payload.t === "alert");
    expect(alerts).toHaveLength(1);

    // Fin du Fantôme : la visibilité revient au tick suivant.
    await f.db.advance(13_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(h).rpc("game_tick", { p_game: f.gameId });
    expect((await f.db.as(h).rpc<Json>("get_game_view", { p_game: f.gameId })).visible).toHaveLength(1);
  });

  it("Blocage ferme une case pour tous puis expire", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 1 });
    await skipPreparation(f);
    const [h] = f.hunters, [fu] = f.fugitives;
    await place(f.db, f.gameId, h, 5, 5);
    await place(f.db, f.gameId, fu, 8, 5);
    await f.db.as(h).rpc("use_ability", { p_game: f.gameId, p_key: "barrier", p_target: { x: 7, y: 5 } });
    await expectRpcError(f.db.as(fu).rpc("move", { p_game: f.gameId, p_path: [[7, 5]] }), "E_BLOCKED");
    const all = (await f.db.broadcasts(`game:${f.gameId}:all`)).map((m) => m.payload.t);
    expect(all).toContain("map_effect");
    await f.db.advance(41_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(fu).rpc("move", { p_game: f.gameId, p_path: [[7, 5]] });
    const all2 = (await f.db.broadcasts(`game:${f.gameId}:all`)).map((m) => m.payload.t);
    expect(all2).toContain("map_effect_removed");
  });

  it("Traqueur, Accélération, Brouilleur et limites d'utilisation", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 1, config: { abilities: { tracker: { max_uses: 1, cooldown_s: 5 } } } });
    await skipPreparation(f);
    const [h] = f.hunters, [fu] = f.fugitives;
    await place(f.db, f.gameId, h, 2, 10);
    await place(f.db, f.gameId, fu, 15, 10);
    const t = await f.db.as(h).rpc<Json>("use_ability", { p_game: f.gameId, p_key: "tracker" });
    expect(t.result).toMatchObject({ dir: "E", band: "far" });
    await f.db.advance(6_000);
    await keepAlive(f.db, f.gameId);
    await expectRpcError(f.db.as(h).rpc("use_ability", { p_game: f.gameId, p_key: "tracker" }), "E_NO_USES_LEFT");

    await f.db.sql(`update public.player_states set steps = 0, steps_at = private.now_() where user_id = $1`, [fu.id]);
    const s = await f.db.as(fu).rpc<Json>("use_ability", { p_game: f.gameId, p_key: "sprint" });
    expect(s.result.steps).toBe(2);
    await f.db.advance(1_000); // régénération doublée : 1 pas par seconde
    const mv = await f.db.as(fu).rpc<Json>("move", { p_game: f.gameId, p_path: [[16, 10], [17, 10], [18, 10]] });
    expect(mv.steps).toBe(0);

    await f.db.as(fu).rpc("use_ability", { p_game: f.gameId, p_key: "jammer" });
    expect((await playerRow(f.db, f.gameId, fu)).jam_until).not.toBeNull();
  });

  it("refuse une capacité désactivée par l'hôte", async () => {
    const f = await setupGame({ config: { abilities: { ghost: { enabled: false } } } });
    await skipPreparation(f);
    await expectRpcError(f.db.as(f.fugitives[0]).rpc("use_ability", { p_game: f.gameId, p_key: "ghost" }), "E_ABILITY_DISABLED");
    await expectRpcError(f.db.as(f.fugitives[0]).rpc("use_ability", { p_game: f.gameId, p_key: "nuke" }), "E_UNKNOWN_ABILITY");
  });
});

describe("resynchronisation", () => {
  it("get_game_view fournit l'état complet autorisé et les numéros de séquence", async () => {
    const f = await setupGame({ hunters: 2, fugitives: 2 });
    await skipPreparation(f);
    const v = await f.db.as(f.hunters[0]).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(v.game.phase).toBe("running");
    expect(v.allies.map((a: Json) => a.u).sort()).toEqual(f.hunters.map((h) => h.id).sort());
    expect(v.players).toHaveLength(4);
    for (const p of v.players) expect(p).not.toHaveProperty("x");
    const [g] = await f.db.sql<Json>(`select seq_all, seq_hunter from public.games where id = $1`, [f.gameId]);
    expect(v.streams.all).toBe(Number(g.seq_all));
    expect(v.streams.team).toBe(Number(g.seq_hunter));
    await expectRpcError(
      f.db.as(await f.db.createUser("Intrus")).rpc("get_game_view", { p_game: f.gameId }), "E_NOT_PARTICIPANT");
  });
});
