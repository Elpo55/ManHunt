/** Moteur de partie GPS : positions, confidentialité, zone, captures, radar, capacités, sécurité. */
import { describe, expect, it } from "vitest";
import { TestDb, expectRpcError } from "./harness";
import { ZONE, at, gamePhase, keepAlive, place, playerRow, report, setupGame, skipPreparation } from "./fixtures";

type Json = Record<string, any>;
const M_LAT = 111_320;
function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dx = (b.lng - a.lng) * M_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dx, (b.lat - a.lat) * M_LAT);
}
const evs = async (db: TestDb, topic: string, t: string) =>
  (await db.broadcasts(topic)).filter((m) => m.payload.t === t).map((m) => m.payload.d as Json);

describe("démarrage", () => {
  it("exige une zone définie et le consentement de chaque membre", async () => {
    const db = await TestDb.create();
    const a = await db.createUser("Alpha");
    const b = await db.createUser("Bravo");
    const { room_id, code } = await db.as(a).rpc<Json>("create_room", { p_name: "Zone" });
    await db.as(b).rpc("join_room", { p_code: code });
    await db.as(a).rpc("set_member_team", { p_room: room_id, p_user: a.id, p_team: "hunter" });
    await db.as(a).rpc("set_member_team", { p_room: room_id, p_user: b.id, p_team: "fugitive" });
    await expectRpcError(db.as(a).rpc("start_game", { p_room: room_id }), "E_ZONE_NOT_SET");
    await db.as(a).rpc("update_room_settings", { p_room: room_id, p_config: { zone: ZONE } });
    await expectRpcError(db.as(a).rpc("start_game", { p_room: room_id }), "E_CONSENT_MISSING");
    await db.as(a).rpc("set_location_consent", { p_room: room_id, p_consent: true });
    await db.as(b).rpc("set_location_consent", { p_room: room_id, p_consent: true });
    // Modifier les règles annule les consentements.
    await db.as(a).rpc("update_room_settings", { p_room: room_id, p_config: { zone: { ...ZONE, radius_m: 800 } } });
    await expectRpcError(db.as(a).rpc("start_game", { p_room: room_id }), "E_CONSENT_MISSING");
    const st = await db.as(b).rpc<Json>("get_room_state", { p_room: room_id });
    expect(st.members.every((m: Json) => m.location_consent === false)).toBe(true);
  });

  it("ne crée aucune position au lancement (seul le GPS du joueur en fournit)", async () => {
    const f = await setupGame();
    const rows = await f.db.sql(`select * from private.player_positions where game_id = $1`, [f.gameId]);
    expect(rows).toHaveLength(0);
    expect(await gamePhase(f.db, f.gameId)).toBe("preparation");
  });
});

describe("envoi de position", () => {
  it("valide les données et refuse les incohérences", async () => {
    const f = await setupGame();
    const [h] = f.hunters;
    await expectRpcError(
      f.db.as(h).rpc("report_position", { p_game: f.gameId, p_lat: 95, p_lng: 2, p_accuracy: 5, p_recorded_at: f.db.now().getTime() }),
      "E_INVALID_POSITION",
    );
    const p = at(0, 0);
    await expectRpcError(
      f.db.as(h).rpc("report_position", {
        p_game: f.gameId, p_lat: p.lat, p_lng: p.lng, p_accuracy: 5, p_recorded_at: f.db.now().getTime() - 5 * 60_000,
      }),
      "E_STALE_POSITION",
    );
    expect((await report(f.db, f.gameId, h, 0, 0)).accepted).toBe(true);
    // Message plus ancien que le précédent : ignoré sans erreur.
    const old = await f.db.as(h).rpc<Json>("report_position", {
      p_game: f.gameId, p_lat: p.lat, p_lng: p.lng, p_accuracy: 5, p_recorded_at: f.db.now().getTime() - 1000,
    });
    expect(old.accepted).toBe(false);
    // 400 m en 3 s : vitesse implausible.
    await f.db.advance(3000);
    await expectRpcError(report(f.db, f.gameId, h, 400, 0), "E_IMPLAUSIBLE_SPEED");
    // 20 m en 10 s : marche normale.
    await f.db.advance(10_000);
    expect((await report(f.db, f.gameId, h, 20, 0)).accepted).toBe(true);
    expect((await playerRow(f.db, f.gameId, h)).distance).toBe(20);
  });

  it("refuse toute position sans consentement ou hors partie", async () => {
    const f = await setupGame();
    const [fu] = f.fugitives;
    await f.db.as(fu).rpc("set_location_consent", { p_room: f.roomId, p_consent: false });
    await expectRpcError(report(f.db, f.gameId, fu, 0, 0), "E_CONSENT_REQUIRED");
    await f.db.as(f.host).rpc("abort_game", { p_game: f.gameId });
    await expectRpcError(report(f.db, f.gameId, f.hunters[0], 0, 0), "E_GAME_FINISHED");
  });

  it("diffuse ~10 m aux coéquipiers et une position approximative et limitée aux adversaires", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { approx_m: 30, enemy_refresh_s: 15 } });
    await skipPreparation(f);
    const [h] = f.hunters;
    const [f1] = f.fugitives;
    await f.db.clearBroadcasts();
    await report(f.db, f.gameId, f1, 113, -47, 12);
    const ally = (await evs(f.db, `game:${f.gameId}:fugitive`, "pos"))[0];
    const enemy = (await evs(f.db, `game:${f.gameId}:hunter`, "enemy_pos"))[0];
    const exact = at(113, -47);
    expect(distM(exact, ally)).toBeLessThanOrEqual(10 * Math.SQRT1_2 + 0.5);
    expect(enemy.acc).toBe(30);
    expect(distM(exact, enemy)).toBeLessThanOrEqual(30 * Math.SQRT1_2 + 0.5);
    expect(distM(exact, enemy)).toBeGreaterThan(0.5);
    // Aucune position de Fugitif ne part sur le flux public.
    expect(JSON.stringify(await f.db.broadcasts(`game:${f.gameId}:all`))).not.toContain('"lat"');
    // Limitation de fréquence côté adversaires.
    await f.db.advance(5000);
    await report(f.db, f.gameId, f1, 118, -47, 12);
    expect(await evs(f.db, `game:${f.gameId}:hunter`, "enemy_pos")).toHaveLength(1);
    expect(await evs(f.db, `game:${f.gameId}:fugitive`, "pos")).toHaveLength(2);
    await f.db.advance(11_000);
    await report(f.db, f.gameId, f1, 125, -47, 12);
    expect(await evs(f.db, `game:${f.gameId}:hunter`, "enemy_pos")).toHaveLength(2);
    // Le Chasseur, lui, est visible des Fugitifs.
    await report(f.db, f.gameId, h, 0, 0);
    expect(await evs(f.db, `game:${f.gameId}:fugitive`, "enemy_pos")).toHaveLength(1);
  });

  it("ne montre jamais une précision supérieure à celle du GPS", async () => {
    const f = await setupGame({ config: { approx_m: 20 } });
    await skipPreparation(f);
    await f.db.clearBroadcasts();
    await report(f.db, f.gameId, f.fugitives[0], 0, 0, 75);
    const e = (await evs(f.db, `game:${f.gameId}:hunter`, "enemy_pos"))[0];
    expect(e.acc).toBe(75);
  });

  it("cache les Fugitifs aux Chasseurs pendant la préparation", async () => {
    const f = await setupGame();
    await f.db.clearBroadcasts();
    await report(f.db, f.gameId, f.fugitives[0], 50, 50);
    await report(f.db, f.gameId, f.hunters[0], 0, 0);
    expect(await evs(f.db, `game:${f.gameId}:hunter`, "enemy_pos")).toHaveLength(0);
    expect(await evs(f.db, `game:${f.gameId}:fugitive`, "enemy_pos")).toHaveLength(1);
  });
});

describe("zone de jeu", () => {
  it("signale la sortie de zone et élimine un Fugitif après le délai de grâce", async () => {
    const f = await setupGame({ config: { out_of_zone_grace_s: 60 } });
    await skipPreparation(f);
    const [f1] = f.fugitives;
    await place(f.db, f.gameId, f1, 480, 0);
    await f.db.advance(60_000);
    await f.db.clearBroadcasts();
    const r = await report(f.db, f.gameId, f1, 600, 0);
    expect(r.out_of_zone).toBe(true);
    expect((await evs(f.db, `game:${f.gameId}:all`, "zone_status"))[0]).toMatchObject({ u: f1.id, out: true });
    await f.db.advance(61_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
    expect((await playerRow(f.db, f.gameId, f1)).status).toBe("captured");
    expect((await evs(f.db, `game:${f.gameId}:all`, "capture")).at(-1)).toMatchObject({ f: f1.id, reason: "out_of_zone" });
  });

  it("interdit la capture à un Chasseur hors zone", async () => {
    const f = await setupGame();
    await skipPreparation(f);
    const [h] = f.hunters;
    await place(f.db, f.gameId, h, 490, 0);
    await f.db.advance(20_000);
    await report(f.db, f.gameId, h, 600, 0);
    await expectRpcError(f.db.as(h).rpc("attempt_capture", { p_game: f.gameId }), "E_OUT_OF_ZONE");
  });
});

describe("captures", () => {
  it("capture à distance réelle, avec positions fraîches et précises", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { capture_radius_m: 15, capture_cooldown_s: 10 } });
    await skipPreparation(f);
    const [h] = f.hunters;
    const [f1, f2] = f.fugitives;
    await expectRpcError(f.db.as(h).rpc("attempt_capture", { p_game: f.gameId }), "E_POSITION_REQUIRED");
    await place(f.db, f.gameId, h, 0, 0, 50);
    await expectRpcError(f.db.as(h).rpc("attempt_capture", { p_game: f.gameId }), "E_GPS_IMPRECISE");
    await place(f.db, f.gameId, h, 0, 0, 6);
    await place(f.db, f.gameId, f1, 10, 5);
    await place(f.db, f.gameId, f2, 40, 0);
    await expectRpcError(f.db.as(f1).rpc("attempt_capture", { p_game: f.gameId }), "E_WRONG_TEAM");
    const r = await f.db.as(h).rpc<Json>("attempt_capture", { p_game: f.gameId });
    expect(r.captured).toEqual([f1.id]);
    await expectRpcError(f.db.as(h).rpc("attempt_capture", { p_game: f.gameId }), "E_COOLDOWN");
    // Position du Fugitif trop ancienne : pas de capture.
    await f.db.advance(11_000);
    await place(f.db, f.gameId, h, 30, 0);
    await f.db.sql(`update private.player_positions set received_at = private.now_() - interval '30 seconds' where user_id = $1`, [f2.id]);
    expect((await f.db.as(h).rpc<Json>("attempt_capture", { p_game: f.gameId })).captured).toEqual([]);
    await f.db.advance(11_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(h).rpc("attempt_capture", { p_game: f.gameId });
    const [g] = await f.db.sql<Json>(`select winner, end_reason from public.games where id = $1`, [f.gameId]);
    expect(g).toEqual({ winner: "hunter", end_reason: "all_captured" });
  });

  it("mode Infection : le Fugitif capturé rejoint les Chasseurs et perd l'accès à son ancien canal", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { mode: "infection" } });
    await skipPreparation(f);
    const [h] = f.hunters;
    const [f1, f2] = f.fugitives;
    await place(f.db, f.gameId, h, 0, 0);
    await place(f.db, f.gameId, f1, 5, 0);
    await place(f.db, f.gameId, f2, 200, 0);
    await f.db.as(h).rpc("attempt_capture", { p_game: f.gameId });
    expect((await playerRow(f.db, f.gameId, f1)).team).toBe("hunter");
    expect(await f.db.as(f1).canRead(`game:${f.gameId}:fugitive:e1`)).toBe(false);
    expect(await f.db.as(f2).canRead(`game:${f.gameId}:fugitive:e1`)).toBe(true);
  });
});

describe("radar GPS", () => {
  it("calcule direction et distance depuis le barycentre de l'équipe, signale brouillage et perte", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 3, config: { radar: { interval_s: 30, precision: "direction" } } });
    await skipPreparation(f);
    const [h] = f.hunters;
    const [f1, f2] = f.fugitives;
    await place(f.db, f.gameId, h, 0, 0);
    await place(f.db, f.gameId, f1, 0, -250); // 250 m au Nord
    await place(f.db, f.gameId, f2, 400, 0);
    await f.db.sql(`update public.player_states set jam_until = private.now_() + interval '5 minutes' where user_id = $1`, [f2.id]);
    await f.db.clearBroadcasts();
    await f.db.advance(30_500);
    await keepAlive(f.db, f.gameId);
    await f.db.as(h).rpc("game_tick", { p_game: f.gameId });
    const radar = (await evs(f.db, `game:${f.gameId}:hunter`, "radar"))[0];
    expect(radar.precision).toBe("direction");
    expect(radar.contacts).toContainEqual({ dir: "N", band: "mid", dist_m: 250 });
    expect(radar.contacts).toContainEqual({ jammed: true });
    expect(radar.contacts).toContainEqual({ lost: true }); // le 3e Fugitif n'a jamais envoyé de position
    expect(await evs(f.db, `game:${f.gameId}:fugitive`, "radar_ping")).toHaveLength(1);
  });

  it("précisions secteur et zone ; mode « pulse » révèle les positions aux deux équipes", async () => {
    const f = await setupGame({
      hunters: 1, fugitives: 1, config: { enemy_reveal: "pulse", radar: { interval_s: 30, precision: "zone" } },
    });
    await skipPreparation(f);
    const [h] = f.hunters;
    const [fu] = f.fugitives;
    await f.db.clearBroadcasts();
    await report(f.db, f.gameId, fu, 100, 100);
    await report(f.db, f.gameId, h, -100, -100);
    expect(await evs(f.db, `game:${f.gameId}:hunter`, "enemy_pos")).toHaveLength(0);
    await f.db.advance(30_500);
    await keepAlive(f.db, f.gameId);
    await f.db.as(h).rpc("game_tick", { p_game: f.gameId });
    const radar = (await evs(f.db, `game:${f.gameId}:hunter`, "radar"))[0];
    const c = radar.contacts[0];
    expect(distM(at(100, 100), c)).toBeLessThanOrEqual(c.r_m);
    expect(await evs(f.db, `game:${f.gameId}:hunter`, "enemy_pos")).toHaveLength(1);
    expect(await evs(f.db, `game:${f.gameId}:fugitive`, "enemy_pos")).toHaveLength(1);
    const [{ s }] = await f.db.sql<Json>(`select private.radar_contacts_gps($1, 'hunter', 'sector', null, null) s`, [f.gameId]);
    expect(s[0]).toEqual({ sector: 3, ring: 0 }); // Sud-Est, à 141 m du centre (< 250 m)
  });
});

describe("capacités GPS", () => {
  it("Fantôme masque, Leurre déplace la position perçue, Brouilleur dégrade la précision", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 3 });
    await skipPreparation(f);
    const [g1, d1, j1] = f.fugitives;
    for (const u of f.fugitives) await place(f.db, f.gameId, u, 0, 0);
    await f.db.clearBroadcasts();
    await f.db.as(g1).rpc("use_ability", { p_game: f.gameId, p_key: "ghost" });
    await f.db.as(d1).rpc("use_ability", { p_game: f.gameId, p_key: "decoy" });
    await f.db.as(j1).rpc("use_ability", { p_game: f.gameId, p_key: "jammer" });
    const seen = await evs(f.db, `game:${f.gameId}:hunter`, "enemy_pos");
    const ghost = seen.find((e) => e.u === g1.id)!;
    expect(ghost).toMatchObject({ hidden: true });
    expect(ghost.lat).toBeUndefined();
    expect(distM(at(0, 0), seen.find((e) => e.u === d1.id)!)).toBeGreaterThan(100);
    expect(seen.find((e) => e.u === j1.id)!.acc).toBe(150);
  });

  it("Scan, Traqueur et Sonar exigent une position et renvoient des informations validées", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2 });
    await skipPreparation(f);
    const [h] = f.hunters;
    const [f1, f2] = f.fugitives;
    await expectRpcError(f.db.as(h).rpc("use_ability", { p_game: f.gameId, p_key: "sonar" }), "E_POSITION_REQUIRED");
    await place(f.db, f.gameId, h, 0, 0);
    await place(f.db, f.gameId, f1, 0, 100); // 100 m au Sud
    await place(f.db, f.gameId, f2, 600, 0);
    const sonar = await f.db.as(h).rpc<Json>("use_ability", { p_game: f.gameId, p_key: "sonar" });
    expect(sonar.result).toMatchObject({ count: 1, radius_m: 150 });
    const tr = await f.db.as(h).rpc<Json>("use_ability", { p_game: f.gameId, p_key: "tracker" });
    expect(tr.result).toMatchObject({ dir: "S", band: "mid", dist_m: 100 });
    const scan = await f.db.as(h).rpc<Json>("use_ability", { p_game: f.gameId, p_key: "scan" });
    expect(scan.result.contacts).toHaveLength(1);
    expect(scan.result.contacts[0].u).toBe(f1.id);
    expect((await evs(f.db, `game:${f.gameId}:p:${f1.id}`, "alert"))[0]).toEqual({ kind: "scanned" });
    await expectRpcError(f.db.as(f1).rpc("use_ability", { p_game: f.gameId, p_key: "sprint" }), "E_UNKNOWN_ABILITY");
  });
});

describe("sécurité et confidentialité", () => {
  it("l'arrêt de sécurité stoppe le partage, retire le joueur et efface ses positions", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2 });
    await skipPreparation(f);
    const [f1] = f.fugitives;
    await report(f.db, f.gameId, f1, 10, 10);
    await f.db.as(f1).rpc("safety_stop", { p_game: f.gameId });
    expect((await playerRow(f.db, f.gameId, f1)).status).toBe("abandoned");
    expect(await f.db.sql(`select * from private.player_positions where user_id = $1`, [f1.id])).toHaveLength(0);
    expect(await f.db.sql(`select * from private.position_history where user_id = $1`, [f1.id])).toHaveLength(0);
    await f.db.advance(3000);
    await expectRpcError(report(f.db, f.gameId, f1, 10, 10), "E_NOT_ACTIVE");
  });

  it("efface les positions brutes 24 h après la fin de partie", async () => {
    const f = await setupGame();
    await skipPreparation(f);
    await report(f.db, f.gameId, f.hunters[0], 0, 0);
    await f.db.as(f.host).rpc("abort_game", { p_game: f.gameId });
    await f.db.advance(23 * 3600_000);
    await f.db.sql(`select private.cleanup()`);
    expect(await f.db.sql(`select * from private.player_positions where game_id = $1`, [f.gameId])).toHaveLength(1);
    await f.db.advance(2 * 3600_000);
    await f.db.sql(`select private.cleanup()`);
    expect(await f.db.sql(`select * from private.player_positions where game_id = $1`, [f.gameId])).toHaveLength(0);
    expect(await f.db.sql(`select * from private.position_history where game_id = $1`, [f.gameId])).toHaveLength(0);
  });

  it("la vue de partie ne contient que des positions arrondies pour les autres joueurs", async () => {
    const f = await setupGame({ hunters: 2, fugitives: 1 });
    await skipPreparation(f);
    const [h1, h2] = f.hunters;
    const [fu] = f.fugitives;
    await report(f.db, f.gameId, h1, 33, 17);
    await report(f.db, f.gameId, h2, 71, 23);
    await report(f.db, f.gameId, fu, 137, 89);
    const v = await f.db.as(h1).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(distM(at(33, 17), v.me)).toBeLessThan(0.5); // ma propre position, exacte
    expect(v.allies).toHaveLength(1);
    expect(v.allies[0].acc).toBeGreaterThanOrEqual(10);
    expect(v.enemies).toHaveLength(1);
    expect(v.enemies[0].acc).toBeGreaterThanOrEqual(30);
    expect(distM(at(137, 89), v.enemies[0])).toBeGreaterThan(0.5);
  });
});

describe("règles conservées", () => {
  it("pause : chrono gelé ; fin du temps : victoire des Fugitifs", async () => {
    const f = await setupGame({ config: { duration_s: 300 } });
    await skipPreparation(f);
    const [before] = await f.db.sql<Json>(`select phase_ends_at from public.games where id = $1`, [f.gameId]);
    await f.db.as(f.host).rpc("pause_game", { p_game: f.gameId });
    await f.db.advance(60_000);
    await f.db.as(f.host).rpc("resume_game", { p_game: f.gameId });
    const [after] = await f.db.sql<Json>(`select phase_ends_at from public.games where id = $1`, [f.gameId]);
    expect(new Date(after.phase_ends_at).getTime() - new Date(before.phase_ends_at).getTime()).toBe(60_000);
    await f.db.advance(301_000);
    await keepAlive(f.db, f.gameId);
    await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
    const [g] = await f.db.sql<Json>(`select winner, end_reason from public.games where id = $1`, [f.gameId]);
    expect(g).toEqual({ winner: "fugitive", end_reason: "time_up" });
  });

  it("abandon après le délai de grâce sans signe de vie", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { disconnect_grace_s: 60 } });
    await skipPreparation(f);
    await f.db.advance(61_000);
    await f.db.as(f.hunters[0]).rpc("heartbeat", { p_game: f.gameId });
    expect((await playerRow(f.db, f.gameId, f.fugitives[0])).status).toBe("abandoned");
    expect(await gamePhase(f.db, f.gameId)).toBe("finished");
  });
});
