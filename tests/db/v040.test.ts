/**
 * v0.4.0 — administration, modes Royale / Mister X, capture QR, objectifs,
 * zones interdites, spectateurs, communication d'équipe, SOS, santé, replay, succès.
 * PostgreSQL réel (PGlite), RLS et rôles appliqués comme en production.
 */
import { describe, expect, it } from "vitest";
import { TestDb, expectRpcError, type TestUser } from "./harness";
import { ZONE, at, gamePhase, keepAlive, place, playerRow, report, setupGame, skipPreparation, type GameFixture } from "./fixtures";

type Json = Record<string, any>;
const events = (db: TestDb, gameId: string, type: string, stream?: string) =>
  db.sql<{ stream: string; payload: Json }>(
    `select stream, payload from public.game_events where game_id = $1 and type = $2 and ($3::text is null or stream = $3) order by id`,
    [gameId, type, stream ?? null],
  );
const setRole = (db: TestDb, u: TestUser, role: string) => db.sql(`update public.profiles set role = $2 where id = $1`, [u.id, role]);
/** Avance le temps en gardant tout le monde présent (positions fraîches). */
async function advance(f: GameFixture, ms: number) {
  await f.db.advance(ms);
  await keepAlive(f.db, f.gameId);
  await f.db.as(f.host).rpc("game_tick", { p_game: f.gameId });
}

describe("administration et rôles", () => {
  it("seul le propriétaire attribue les rôles ; un modérateur sanctionne dans ses limites ; tout est journalisé", async () => {
    const db = await TestDb.create();
    const owner = await db.createUser("Owner");
    const mod = await db.createUser("Modo");
    const p1 = await db.createUser("Joueur1");
    await setRole(db, owner, "owner");
    await expectRpcError(db.as(mod).rpc("admin_set_role", { p_user: p1.id, p_role: "admin", p_reason: "test" }), "E_FORBIDDEN");
    await db.as(owner).rpc("admin_set_role", { p_user: mod.id, p_role: "moderator", p_reason: "Équipe de modération" });
    expect(await db.as(mod).rpc("get_my_role")).toBe("moderator");
    // Le propriétaire ne peut pas se rétrograder, ni créer un second propriétaire.
    await expectRpcError(db.as(owner).rpc("admin_set_role", { p_user: owner.id, p_role: "player", p_reason: "test" }), "E_FORBIDDEN");
    await expectRpcError(db.as(owner).rpc("admin_set_role", { p_user: p1.id, p_role: "owner", p_reason: "test" }), "E_INVALID_ROLE");

    await db.as(mod).rpc("admin_warn", { p_user: p1.id, p_reason: "Langage" });
    await expectRpcError(db.as(mod).rpc("admin_suspend", { p_user: p1.id, p_hours: 100, p_reason: "Trop long" }), "E_FORBIDDEN");
    await expectRpcError(db.as(mod).rpc("admin_suspend", { p_user: owner.id, p_hours: 1, p_reason: "Rang" }), "E_FORBIDDEN");
    await expectRpcError(db.as(mod).rpc("admin_warn", { p_user: p1.id, p_reason: "x" }), "E_REASON_REQUIRED");
    const s = await db.as(mod).rpc<Json>("admin_suspend", { p_user: p1.id, p_hours: 24, p_reason: "Triche répétée" });
    await expectRpcError(db.as(p1).rpc("create_room", { p_name: "Salon" }), "E_SUSPENDED");
    const notices = await db.as(p1).rpc<Json[]>("get_my_notices");
    expect(notices.map((n) => n.kind).sort()).toEqual(["suspension", "warning"]);
    await db.as(mod).rpc("admin_revoke_sanction", { p_sanction: s.id, p_reason: "Erreur de cible" });
    await db.as(p1).rpc("create_room", { p_name: "Salon" });
    // Un joueur n'a accès à rien.
    await expectRpcError(db.as(p1).rpc("admin_overview"), "E_FORBIDDEN");
    await expectRpcError(db.as(p1).rpc("admin_audit_log", { p_limit: 10 }), "E_FORBIDDEN");
    const audit = await db.as(mod).rpc<Json[]>("admin_audit_log", { p_limit: 50 });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["set_role", "warn", "suspend", "revoke_sanction"]));
    expect(audit.find((a) => a.action === "suspend")).toMatchObject({ actor: "Modo", target_id: p1.id, reason: "Triche répétée" });
    // Les tables d'administration ne sont pas lisibles directement.
    await expect(db.as(mod).query(`select * from public.admin_audit`)).rejects.toThrow();
    await expect(db.as(p1).query(`select * from public.sanctions`)).rejects.toThrow();
  });

  it("les interventions en partie sont annoncées, journalisées et ne donnent aucune position", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2 });
    const admin = await f.db.createUser("Admin");
    await setRole(f.db, admin, "admin");
    await skipPreparation(f);
    await report(f.db, f.gameId, f.fugitives[0], 50, 50);
    const detail = await f.db.as(admin).rpc<Json>("admin_game_detail", { p_game: f.gameId });
    expect(JSON.stringify(detail)).not.toMatch(/"lat"|"lng"/);
    expect(detail.players).toHaveLength(3);
    await f.db.as(admin).rpc("admin_pause_game", { p_game: f.gameId, p_reason: "Problème technique" });
    expect(await gamePhase(f.db, f.gameId)).toBe("paused");
    expect((await events(f.db, f.gameId, "admin_action", "all"))[0].payload).toMatchObject({ action: "pause", reason: "Problème technique", role: "admin" });
    await f.db.as(admin).rpc("admin_resume_game", { p_game: f.gameId, p_reason: "Réglé" });
    await f.db.as(admin).rpc("admin_end_game", { p_game: f.gameId, p_reason: "Partie bloquée" });
    const g = (await f.db.sql<Json>(`select phase, winner, end_reason from public.games where id = $1`, [f.gameId]))[0];
    expect(g).toMatchObject({ phase: "finished", winner: "draw", end_reason: "aborted" });
    // Résultat non compté : aucune statistique de profil modifiée.
    expect((await f.db.sql<Json>(`select bool_or(counted) c from public.game_statistics where game_id = $1`, [f.gameId]))[0].c).toBe(false);
    // Aucune fonction d'administration ne permet de capturer, déplacer ou modifier un résultat.
    const fns = await f.db.sql<{ n: string }>(`select proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and proname like 'admin\\_%'`);
    expect(fns.map((x) => x.n).filter((n) => /capture|move|position|result|score|teleport/.test(n))).toEqual([]);
  });

  it("paramètres globaux : limite de joueurs appliquée, fonctionnalité désactivable", async () => {
    const db = await TestDb.create();
    const admin = await db.createUser("Admin");
    const host = await db.createUser("Hote");
    await setRole(db, admin, "admin");
    await expectRpcError(db.as(host).rpc("admin_set_setting", { p_key: "limits", p_value: { max_players: 8 }, p_reason: "test" }), "E_FORBIDDEN");
    await db.as(admin).rpc("admin_set_setting", { p_key: "limits", p_value: { max_players: 8, max_rooms_per_user: 10 }, p_reason: "Petits groupes" });
    await expectRpcError(db.as(host).rpc("create_room", { p_name: "Grand salon", p_max_players: 12 }), "E_MAX_PLAYERS_LIMIT");
    await db.as(host).rpc("create_room", { p_name: "Petit salon", p_max_players: 8 });
    const settings = await db.as(host).rpc<Json>("get_app_settings");
    expect(settings.limits.max_players).toBe(8);
    await db.as(admin).rpc("admin_set_setting", { p_key: "limits", p_value: { max_players: 20 }, p_reason: "Retour à 20" });

    const f = await setupGame({ db, hunters: 1, fugitives: 1, config: { mode: "royale" } });
    expect(f.gameId).toBeTruthy();
    await db.as(admin).rpc("admin_set_setting", { p_key: "features", p_value: { royale: false }, p_reason: "Mode en test" });
    await expectRpcError(setupGame({ db, hunters: 1, fugitives: 1, config: { mode: "royale" } }), "E_FEATURE_DISABLED");
  });

  it("versions publiées : lisibles sans connexion, publication réservée aux administrateurs", async () => {
    const db = await TestDb.create();
    const admin = await db.createUser("Admin");
    const p = await db.createUser("Joueur");
    await setRole(db, admin, "admin");
    await expectRpcError(db.as(p).rpc("admin_publish_release", { p_platform: "android", p_version: "0.4.0", p_severity: "optional", p_url: null, p_notes: "x" }), "E_FORBIDDEN");
    await expectRpcError(db.as(admin).rpc("admin_publish_release", { p_platform: "android", p_version: "0.4.0", p_severity: "optional", p_url: "http://x", p_notes: "x" }), "E_INVALID_URL");
    const r = await db.as(admin).rpc<Json>("admin_publish_release", {
      p_platform: "android", p_version: "0.4.0", p_severity: "recommended", p_url: "https://exemple.test/manhunt.apk", p_notes: "Nouveautés", p_min_supported_build: 300,
    });
    expect(r.build).toBe(400);
    await db.pg.query("reset role");
    await db.pg.query("set role anon");
    const latest = (await db.pg.query<{ r: Json }>(`select public.get_latest_release('android') r`)).rows[0].r;
    await db.pg.query("reset role");
    expect(latest).toMatchObject({ version: "0.4.0", build: 400, severity: "recommended", min_supported_build: 300 });
  });

  it("signalements : création par un joueur, traitement, notes et clôture", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 1 });
    const mod = await f.db.createUser("Modo");
    await setRole(f.db, mod, "moderator");
    const [h] = f.hunters;
    const [fu] = f.fugitives;
    await expectRpcError(f.db.as(h).rpc("report_player", { p_target: h.id, p_category: "cheating", p_message: "Moi-même" }), "E_FORBIDDEN");
    const rep = await f.db.as(h).rpc<Json>("report_player", { p_target: fu.id, p_category: "unsafe", p_message: "Traverse la route en courant", p_game: f.gameId });
    await f.db.as(mod).rpc("admin_report_note", { p_report: rep.id, p_note: "Contacté le joueur" });
    await f.db.as(mod).rpc("admin_report_status", { p_report: rep.id, p_status: "closed", p_resolution: "Avertissement oral" });
    const list = await f.db.as(mod).rpc<Json[]>("admin_reports", { p_status: null });
    expect(list[0]).toMatchObject({ status: "closed", resolution: "Avertissement oral", category: "unsafe" });
    expect(list[0].notes[0]).toMatchObject({ note: "Contacté le joueur", author: "Modo" });
  });
});

describe("modes de jeu", () => {
  it("Royale : la zone se réduit côté serveur et les joueurs dehors passent hors zone", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { mode: "royale", royale: { stages: 3, final_ratio: 0.4 } } });
    await skipPreparation(f);
    const g0 = (await f.db.sql<Json>(`select zone_current, zone_next, zone_next_at, running_at from public.games where id = $1`, [f.gameId]))[0];
    expect(g0.zone_current.radius_m).toBe(500);
    expect(g0.zone_next.radius_m).toBe(400); // 500 × (1 − 0,6 × 1/3)
    expect(new Date(g0.zone_next_at).getTime() - new Date(g0.running_at).getTime()).toBe(450_000); // 1800 s / (3 + 1)
    expect((await events(f.db, f.gameId, "zone_next", "all")).length).toBe(1);
    // Un Fugitif près du bord, hors de toute zone réduite possible.
    await report(f.db, f.gameId, f.fugitives[0], 480, 0);
    await report(f.db, f.gameId, f.fugitives[1], 0, 0);
    await advance(f, 451_000);
    const g1 = (await f.db.sql<Json>(`select zone_current, zone_stage from public.games where id = $1`, [f.gameId]))[0];
    expect(g1).toMatchObject({ zone_stage: 1 });
    expect(g1.zone_current.radius_m).toBe(400);
    expect((await playerRow(f.db, f.gameId, f.fugitives[0])).out_of_zone_since).not.toBeNull();
    expect((await events(f.db, f.gameId, "zone_shrink", "all")).length).toBe(1);
    // La vue expose la zone courante et la prochaine.
    const v = await f.db.as(f.hunters[0]).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(v.ext.zone).toMatchObject({ stage: 1, stages: 3 });
    // Royale exige une zone circulaire.
    await expectRpcError(
      setupGame({ config: { mode: "royale", zone: { ...ZONE, shape: "polygon", polygon: [at(0, 0), at(300, 0), at(0, 300)] } } }),
      "E_ROYALE_NEEDS_CIRCLE",
    );
  });

  it("Mister X : un seul Fugitif, jamais diffusé en direct, révélé à intervalle aux seuls Chasseurs", async () => {
    await expectRpcError(setupGame({ hunters: 1, fugitives: 2, config: { mode: "misterx" } }), "E_MISTERX_ONE_FUGITIVE");
    const f = await setupGame({ hunters: 2, fugitives: 1, config: { mode: "misterx", misterx: { reveal_interval_s: 120 } } });
    await skipPreparation(f);
    const [mx] = f.fugitives;
    await report(f.db, f.gameId, mx, 100, 50);
    await f.db.advance(20_000);
    await report(f.db, f.gameId, mx, 110, 50);
    expect(await events(f.db, f.gameId, "enemy_pos")).toHaveLength(0);
    await advance(f, 101_000);
    const rev = await events(f.db, f.gameId, "misterx_reveal");
    expect(rev).toHaveLength(1);
    expect(rev[0].stream).toBe("hunter");
    expect(rev[0].payload.u).toBe(mx.id);
    expect(Math.abs(rev[0].payload.lat - at(110, 50).lat)).toBeLessThan(0.0001);
    expect((await events(f.db, f.gameId, "misterx_revealed", `p:${mx.id}`)).length).toBe(1);
    const vh = await f.db.as(f.hunters[0]).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(vh.ext.misterx.last.u).toBe(mx.id);
    const vm = await f.db.as(mx).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(vm.ext.misterx.last).toBeNull();
  });
});

describe("capture par QR code", () => {
  it("jeton à usage unique, même partie, durée limitée, distance plausible ; code manuel en secours", async () => {
    const f = await setupGame({ hunters: 2, fugitives: 2 });
    await skipPreparation(f);
    const [h1, h2] = f.hunters;
    const [f1, f2] = f.fugitives;
    await place(f.db, f.gameId, h1, 0, 0);
    await place(f.db, f.gameId, f1, 10, 0);
    await expectRpcError(f.db.as(h1).rpc("get_capture_token", { p_game: f.gameId }), "E_NOT_ACTIVE");
    const t = await f.db.as(f1).rpc<Json>("get_capture_token", { p_game: f.gameId });
    expect(t.qr).toMatch(new RegExp(`^manhunt:cap:${f.gameId}:[0-9a-f]{64}$`));
    expect(t.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    await expectRpcError(f.db.as(h1).rpc("capture_by_token", { p_game: f.gameId, p_code: t.qr.replace(/.$/, "0") + "x" }), "E_TOKEN_INVALID");
    const r = await f.db.as(h1).rpc<Json>("capture_by_token", { p_game: f.gameId, p_code: t.qr });
    expect(r.captured).toEqual([f1.id]);
    expect((await playerRow(f.db, f.gameId, f1)).status).toBe("captured");
    await f.db.advance(11_000);
    await keepAlive(f.db, f.gameId);
    await expectRpcError(f.db.as(h2).rpc("capture_by_token", { p_game: f.gameId, p_code: t.qr }), "E_TOKEN_USED");
    // Code manuel, mais Fugitif trop loin (capture d'écran envoyée à distance) : refusé.
    await place(f.db, f.gameId, h2, 0, 0);
    await place(f.db, f.gameId, f2, 400, 0);
    const t2 = await f.db.as(f2).rpc<Json>("get_capture_token", { p_game: f.gameId });
    await expectRpcError(f.db.as(h2).rpc("capture_by_token", { p_game: f.gameId, p_code: t2.code.toLowerCase() }), "E_TOO_FAR");
    // Expiré.
    await f.db.advance(46_000);
    await keepAlive(f.db, f.gameId);
    await place(f.db, f.gameId, f2, 5, 0);
    await expectRpcError(f.db.as(h2).rpc("capture_by_token", { p_game: f.gameId, p_code: t2.code }), "E_TOKEN_INVALID");
    // Méthode « QR seulement » : la capture GPS est refusée.
    const g = await setupGame({ hunters: 1, fugitives: 1, config: { capture_method: "qr" } });
    await skipPreparation(g);
    await expectRpcError(g.db.as(g.hunters[0]).rpc("attempt_capture", { p_game: g.gameId }), "E_CAPTURE_METHOD");
    // Les jetons ne sont jamais lisibles.
    await expect(f.db.as(h1).query(`select * from private.capture_tokens`)).rejects.toThrow();
  });
});

describe("objectifs et zones", () => {
  it("balises atteintes par les Fugitifs, extraction ouverte en fin de partie, score et victoire", async () => {
    const beacons = [{ ...at(100, 0), label: "Fontaine" }, { ...at(-100, 0), label: "Kiosque" }];
    await expectRpcError(
      setupGame({ config: { objectives: { enabled: true, beacons: [{ ...at(900, 0), label: "Hors zone" }] } } }),
      "E_OBJECTIVE_OUTSIDE",
    );
    const f = await setupGame({
      hunters: 1, fugitives: 2,
      config: { duration_s: 600, objectives: { enabled: true, beacons, win_on_all: true, extraction: { set: true, ...at(0, 200), label: "Parking" }, extraction_open_s: 120 } },
    });
    await skipPreparation(f);
    const [f1, f2] = f.fugitives;
    await report(f.db, f.gameId, f1, 105, 5);
    expect((await events(f.db, f.gameId, "objective_claimed", "all"))[0].payload).toMatchObject({ idx: 1, u: f1.id, label: "Fontaine" });
    // Un Chasseur n'atteint pas de balise.
    await report(f.db, f.gameId, f.hunters[0], -100, 0);
    expect((await f.db.sql<Json>(`select claimed_by from public.game_objectives where game_id = $1 and idx = 2`, [f.gameId]))[0].claimed_by).toBeNull();
    // Extraction : pas encore ouverte.
    await report(f.db, f.gameId, f2, 0, 200);
    expect((await playerRow(f.db, f.gameId, f2)).extracted_at).toBeNull();
    await advance(f, 481_000);
    expect(await events(f.db, f.gameId, "extraction_open", "all")).toHaveLength(1);
    await f.db.advance(1000);
    await report(f.db, f.gameId, f2, 0, 198);
    expect((await playerRow(f.db, f.gameId, f2)).extracted_at).not.toBeNull();
    // Fugitif extrait : protégé de la capture GPS.
    await place(f.db, f.gameId, f.hunters[0], 0, 195);
    const cap = await f.db.as(f.hunters[0]).rpc<Json>("attempt_capture", { p_game: f.gameId });
    expect(cap.captured).toEqual([]);
    // Dernière balise : victoire des Fugitifs par objectifs.
    await f.db.advance(20_000); // ~8 m/s : sous la vitesse maximale (anti-triche)
    await report(f.db, f.gameId, f1, -60, 2);
    await f.db.advance(5_000);
    await report(f.db, f.gameId, f1, -98, 2);
    const g = (await f.db.sql<Json>(`select phase, winner, end_reason from public.games where id = $1`, [f.gameId]))[0];
    expect(g).toMatchObject({ phase: "finished", winner: "fugitive", end_reason: "objectives" });
    const st = await f.db.sql<Json>(`select user_id, objectives, extracted, score from public.game_statistics where game_id = $1`, [f.gameId]);
    expect(st.find((s) => s.user_id === f1.id)).toMatchObject({ objectives: 2 });
    expect(st.find((s) => s.user_id === f2.id)).toMatchObject({ extracted: true });
  });

  it("zones polygonales et interdites : hors zone validé côté serveur", async () => {
    const f = await setupGame({
      hunters: 1, fugitives: 2,
      config: { zone: { ...ZONE, shape: "polygon", polygon: [at(-300, -300), at(300, -300), at(300, 300), at(-300, 300)],
                        forbidden: [{ kind: "circle", ...at(0, 0), radius_m: 60, label: "Bassin" }] } },
    });
    await skipPreparation(f);
    const [f1, f2] = f.fugitives;
    await report(f.db, f.gameId, f1, 0, 10); // dans le bassin
    expect((await playerRow(f.db, f.gameId, f1)).out_of_zone_since).not.toBeNull();
    await report(f.db, f.gameId, f2, 400, 0); // hors du polygone
    expect((await playerRow(f.db, f.gameId, f2)).out_of_zone_since).not.toBeNull();
    await f.db.advance(20_000);
    await report(f.db, f.gameId, f2, 250, 0); // revenu dedans
    expect((await playerRow(f.db, f.gameId, f2)).out_of_zone_since).toBeNull();
  });
});

describe("spectateurs et communication d'équipe", () => {
  it("messages et repères réservés à l'équipe ; un capturé ne communique plus et perd le canal d'équipe", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { spectators: { delay_s: 60 } } });
    await skipPreparation(f);
    const [h] = f.hunters;
    const [f1, f2] = f.fugitives;
    await f.db.as(f1).rpc("team_message", { p_game: f.gameId, p_code: "help" });
    expect((await events(f.db, f.gameId, "team_msg"))[0]).toMatchObject({ stream: "fugitive", payload: { u: f1.id, code: "help" } });
    await expectRpcError(f.db.as(f1).rpc("team_message", { p_game: f.gameId, p_code: "seen" }), "E_RATE_LIMITED");
    await expectRpcError(f.db.as(f2).rpc("team_message", { p_game: f.gameId, p_code: "texte libre" }), "E_INVALID_MESSAGE");
    const p = at(50, 50);
    const mk = await f.db.as(f2).rpc<Json>("place_marker", { p_game: f.gameId, p_kind: "danger", p_lat: p.lat, p_lng: p.lng, p_ttl_s: 60 });
    expect((await f.db.as(f1).rpc<Json>("get_game_view", { p_game: f.gameId })).ext.markers.map((m: Json) => m.id)).toEqual([mk.id]);
    expect((await f.db.as(h).rpc<Json>("get_game_view", { p_game: f.gameId })).ext.markers).toEqual([]);
    const far = at(5000, 0);
    await expectRpcError(f.db.as(f2).rpc("place_marker", { p_game: f.gameId, p_kind: "info", p_lat: far.lat, p_lng: far.lng }), "E_MARKER_OUTSIDE");

    const topic = (await f.db.as(f1).rpc<Json>("get_game_view", { p_game: f.gameId })).team_topic;
    expect(await f.db.as(f1).canRead(topic)).toBe(true);
    await place(f.db, f.gameId, h, 0, 0);
    await place(f.db, f.gameId, f1, 5, 0);
    await f.db.as(h).rpc("attempt_capture", { p_game: f.gameId });
    expect((await playerRow(f.db, f.gameId, f1)).status).toBe("captured");
    // Spectateur : plus de messages, plus de canal d'équipe (nouveau topic pour les actifs).
    await f.db.advance(3000);
    await expectRpcError(f.db.as(f1).rpc("team_message", { p_game: f.gameId, p_code: "seen" }), "E_SPECTATOR");
    const topic2 = (await f.db.as(f2).rpc<Json>("get_game_view", { p_game: f.gameId })).team_topic;
    expect(topic2).not.toBe(topic);
    expect(await f.db.as(f1).canRead(topic2)).toBe(false);
    expect(await f.db.as(f2).canRead(topic2)).toBe(true);
    // Vue spectateur : positions différées seulement.
    await expectRpcError(f.db.as(f2).rpc("get_spectator_view", { p_game: f.gameId }), "E_NOT_SPECTATOR");
    await report(f.db, f.gameId, f2, 120, 0);
    const sv0 = await f.db.as(f1).rpc<Json>("get_spectator_view", { p_game: f.gameId });
    expect(sv0.players.find((x: Json) => x.u === f2.id).lat).toBeUndefined(); // trop récent
    await f.db.advance(61_000);
    await keepAlive(f.db, f.gameId);
    const sv1 = await f.db.as(f1).rpc<Json>("get_spectator_view", { p_game: f.gameId });
    expect(sv1.players.find((x: Json) => x.u === f2.id).lat).toBeTypeOf("number");
  });
});

describe("sécurité dans le monde réel", () => {
  it("SOS : pause immédiate, position seulement si acceptée, reprise impossible avant levée", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2 });
    await skipPreparation(f);
    const [f1] = f.fugitives;
    await report(f.db, f.gameId, f1, 30, 40);
    await f.db.as(f1).rpc("sos_raise", { p_game: f.gameId, p_message: "Je me suis blessé à la cheville", p_share_location: true });
    expect(await gamePhase(f.db, f.gameId)).toBe("paused");
    const sos = (await events(f.db, f.gameId, "sos", "all"))[0].payload;
    expect(sos).toMatchObject({ u: f1.id, message: "Je me suis blessé à la cheville" });
    expect(sos.lat).toBeTypeOf("number");
    await expectRpcError(f.db.as(f.host).rpc("resume_game", { p_game: f.gameId }), "E_SOS_ACTIVE");
    await expectRpcError(f.db.as(f.fugitives[1]).rpc("sos_resolve", { p_game: f.gameId, p_note: "ok" }), "E_FORBIDDEN");
    await f.db.as(f1).rpc("sos_resolve", { p_game: f.gameId, p_note: "Ça va" });
    expect(await gamePhase(f.db, f.gameId)).toBe("paused"); // reprise = décision explicite de l'hôte
    await f.db.as(f.host).rpc("resume_game", { p_game: f.gameId });
    expect(await gamePhase(f.db, f.gameId)).toBe("running");
    // Sans accord de partage : aucune position.
    await f.db.advance(1000);
    await f.db.as(f.fugitives[1]).rpc("sos_raise", { p_game: f.gameId, p_message: "", p_share_location: false });
    expect((await events(f.db, f.gameId, "sos", "all"))[1].payload.lat).toBeNull();
  });

  it("GPS muet signalé (sans sanction), santé des appareils réservée à l'équipe", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 2, config: { gps_silent_s: 60 } });
    await skipPreparation(f);
    const [f1, f2] = f.fugitives;
    await report(f.db, f.gameId, f2, 0, 0);
    await f.db.advance(30_000);
    await f.db.as(f1).rpc("heartbeat", { p_game: f.gameId, p_app_state: "background", p_gps_state: "searching", p_battery: 42 });
    expect((await events(f.db, f.gameId, "health"))[0]).toMatchObject({ stream: "fugitive", payload: { u: f1.id, battery: 42, app: "background" } });
    await f.db.advance(31_000);
    await f.db.as(f1).rpc("heartbeat", { p_game: f.gameId });
    await f.db.as(f2).rpc("heartbeat", { p_game: f.gameId });
    await f.db.as(f.hunters[0]).rpc("heartbeat", { p_game: f.gameId });
    const silent = (await events(f.db, f.gameId, "gps_silent", "all")).map((e) => e.payload.u);
    expect(silent).toContain(f1.id);
    expect((await playerRow(f.db, f.gameId, f1)).status).toBe("active");
    const vh = await f.db.as(f.hunters[0]).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(vh.ext.health[f1.id]).toBeUndefined(); // batterie adverse jamais visible
    const vf = await f.db.as(f2).rpc<Json>("get_game_view", { p_game: f.gameId });
    expect(vf.ext.health[f1.id]).toMatchObject({ battery: 42, gps: "searching" });
    // Le GPS muet est aussi signalé pendant la préparation (personne n'avait encore de position).
    await report(f.db, f.gameId, f1, 10, 10);
    expect((await events(f.db, f.gameId, "gps_ok", "all")).map((e) => e.payload.u)).toContain(f1.id);
  });
});

describe("replay, succès et statistiques", () => {
  it("replay 24 h pour les participants, succès débloqués côté serveur, statistiques par mode", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 1 });
    await skipPreparation(f);
    const [h] = f.hunters;
    const [fu] = f.fugitives;
    await expectRpcError(f.db.as(h).rpc("get_replay", { p_game: f.gameId }), "E_GAME_NOT_FINISHED");
    for (let i = 0; i < 4; i++) {
      await report(f.db, f.gameId, h, i * 10, 0);
      await report(f.db, f.gameId, fu, 100 - i * 20, 0);
      await f.db.advance(11_000);
    }
    await place(f.db, f.gameId, h, 30, 0);
    await place(f.db, f.gameId, fu, 35, 0);
    await f.db.as(h).rpc("attempt_capture", { p_game: f.gameId });
    expect(await gamePhase(f.db, f.gameId)).toBe("finished");
    const rp = await f.db.as(fu).rpc<Json>("get_replay", { p_game: f.gameId });
    expect(rp.tracks).toHaveLength(2);
    expect(rp.tracks.find((t: Json) => t.u === h.id).points.length).toBeGreaterThanOrEqual(3);
    expect(rp.events.some((e: Json) => e.t === "capture")).toBe(true);
    const outsider = await f.db.createUser("Curieux");
    await expectRpcError(f.db.as(outsider).rpc("get_replay", { p_game: f.gameId }), "E_NOT_PARTICIPANT");

    const ach = await f.db.as(h).rpc<Json[]>("get_my_achievements");
    const unlocked = ach.filter((a) => a.unlocked_at).map((a) => a.key);
    expect(unlocked).toEqual(expect.arrayContaining(["first_game", "first_win", "first_capture"]));
    expect(ach.find((a) => a.key === "games_10")).toMatchObject({ progress: 1, unlocked_at: null });
    expect((await events(f.db, f.gameId, "achievement", `p:${h.id}`)).length).toBeGreaterThanOrEqual(3);
    const stats = await f.db.as(h).rpc<Json>("get_my_stats");
    expect(stats.by_mode.classic).toMatchObject({ games: 1, wins: 1, captures: 1, as_hunter: 1 });
    expect(stats.streak).toBe(1);

    await f.db.advance(25 * 3600_000);
    await expectRpcError(f.db.as(fu).rpc("get_replay", { p_game: f.gameId }), "E_REPLAY_EXPIRED");
    await f.db.sql(`select private.cleanup()`);
    expect(await f.db.sql(`select 1 from private.position_history where game_id = $1`, [f.gameId])).toHaveLength(0);
  });

  it("une partie interrompue ne débloque aucun succès", async () => {
    const f = await setupGame({ hunters: 1, fugitives: 1 });
    await skipPreparation(f);
    await f.db.as(f.host).rpc("abort_game", { p_game: f.gameId });
    expect(await f.db.sql(`select 1 from public.player_achievements`)).toHaveLength(0);
  });
});
