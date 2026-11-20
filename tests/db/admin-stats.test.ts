/** v0.5.0 (migration 1030) : correction des statistiques et fiche joueur conforme au RGPD. */
import { describe, expect, it } from "vitest";
import { TestDb, expectRpcError, type TestUser } from "./harness";

type Json = Record<string, any>;
const setRole = (db: TestDb, u: TestUser, role: string) => db.sql(`update public.profiles set role = $2 where id = $1`, [u.id, role]);

async function setup() {
  const db = await TestDb.create();
  const owner = await db.createUser("Owner");
  const admin = await db.createUser("Admin");
  const mod = await db.createUser("Modo");
  const p = await db.createUser("Joueur", { anonymous: false });
  await setRole(db, owner, "owner");
  await setRole(db, admin, "admin");
  await setRole(db, mod, "moderator");
  await db.sql(`update public.profiles set games_played = 10, wins = 4, losses = 5, draws = 1, best_streak = 2, win_streak = 1 where id = $1`, [p.id]);
  return { db, owner, admin, mod, p };
}

describe("correction des statistiques (propriétaire)", () => {
  it("seul le propriétaire corrige ; valeurs contrôlées ; avant/après journalisés ; joueur informé", async () => {
    const { db, owner, admin, p } = await setup();
    await expectRpcError(db.as(admin).rpc("admin_correct_stats", { p_user: p.id, p_changes: { wins: 5 }, p_reason: "Erreur" }), "E_FORBIDDEN");
    await expectRpcError(db.as(owner).rpc("admin_correct_stats", { p_user: p.id, p_changes: { wins: 5 }, p_reason: "x" }), "E_REASON_REQUIRED");
    await expectRpcError(db.as(owner).rpc("admin_correct_stats", { p_user: p.id, p_changes: { wins: -1 }, p_reason: "Négatif" }), "E_INVALID_STATS");
    await expectRpcError(db.as(owner).rpc("admin_correct_stats", { p_user: p.id, p_changes: { wins: 1.5 }, p_reason: "Décimal" }), "E_INVALID_STATS");
    await expectRpcError(db.as(owner).rpc("admin_correct_stats", { p_user: p.id, p_changes: { is_admin: true }, p_reason: "Champ interdit" }), "E_INVALID_STATS");
    await expectRpcError(db.as(owner).rpc("admin_correct_stats", { p_user: p.id, p_changes: { wins: 9 }, p_reason: "Incohérent" }), "E_INVALID_STATS");
    await expectRpcError(db.as(owner).rpc("admin_correct_stats", { p_user: p.id, p_changes: { wins: 4 }, p_reason: "Aucun changement" }), "E_INVALID_STATS");
    const r = await db.as(owner).rpc<Json>("admin_correct_stats", {
      p_user: p.id, p_changes: { wins: 5, losses: 4, captures: 12 }, p_reason: "Partie du 12 mal comptée",
    });
    expect(r.before).toEqual({ wins: 4, losses: 5, captures: 0 });
    expect(r.after).toEqual({ wins: 5, losses: 4, captures: 12 });
    const prof = (await db.sql<Json>(`select wins, losses, captures, role, is_admin from public.profiles where id = $1`, [p.id]))[0];
    expect(prof).toMatchObject({ wins: 5, losses: 4, captures: 12, role: "player", is_admin: false });
    const audit = await db.as(owner).rpc<Json[]>("admin_audit_log", { p_limit: 10 });
    expect(audit[0]).toMatchObject({ action: "correct_stats", target_id: p.id, reason: "Partie du 12 mal comptée" });
    expect(audit[0].result.before.wins).toBe(4);
    const notices = await db.as(p).rpc<Json[]>("get_my_notices");
    expect(notices[0]).toMatchObject({ kind: "correction" });
    expect(notices[0].reason).toContain("Partie du 12 mal comptée");
  });

  it("succès attribués / retirés par le propriétaire, journalisés", async () => {
    const { db, owner, mod, p } = await setup();
    await expectRpcError(db.as(mod).rpc("admin_set_achievement", { p_user: p.id, p_key: "first_win", p_unlocked: true, p_reason: "Test" }), "E_FORBIDDEN");
    await expectRpcError(db.as(owner).rpc("admin_set_achievement", { p_user: p.id, p_key: "nope", p_unlocked: true, p_reason: "Test" }), "E_NOT_FOUND");
    await db.as(owner).rpc("admin_set_achievement", { p_user: p.id, p_key: "first_win", p_unlocked: true, p_reason: "Victoire perdue au bug" });
    expect((await db.as(p).rpc<Json[]>("get_my_achievements")).find((a) => a.key === "first_win").unlocked_at).not.toBeNull();
    await expectRpcError(db.as(owner).rpc("admin_set_achievement", { p_user: p.id, p_key: "first_win", p_unlocked: true, p_reason: "Doublon" }), "E_INVALID_STATS");
    await db.as(owner).rpc("admin_set_achievement", { p_user: p.id, p_key: "first_win", p_unlocked: false, p_reason: "Attribué par erreur" });
    expect((await db.as(p).rpc<Json[]>("get_my_achievements")).find((a) => a.key === "first_win").unlocked_at).toBeNull();
    const d = await db.as(owner).rpc<Json>("admin_player_detail", { p_user: p.id });
    expect(d.corrections.map((c: Json) => c.action)).toEqual(["set_achievement", "set_achievement"]);
  });
});

describe("fiche joueur et RGPD", () => {
  it("e-mail masqué par défaut, affichage complet réservé aux admins, motivé et journalisé ; aucune position", async () => {
    const { db, owner, admin, mod, p } = await setup();
    const d = await db.as(mod).rpc<Json>("admin_player_detail", { p_user: p.id });
    expect(d.profile.email_masked).toBe("jo*****@example.test");
    expect(JSON.stringify(d)).not.toContain("joueur@example.test");
    expect(JSON.stringify(d)).not.toMatch(/"lat"|"lng"/);
    expect(d.achievements.length).toBe(13);
    await expectRpcError(db.as(mod).rpc("admin_reveal_email", { p_user: p.id, p_reason: "Support" }), "E_FORBIDDEN");
    await expectRpcError(db.as(admin).rpc("admin_reveal_email", { p_user: p.id, p_reason: "" }), "E_REASON_REQUIRED");
    expect(await db.as(admin).rpc("admin_reveal_email", { p_user: p.id, p_reason: "Compte bloqué, demande du joueur" })).toBe("joueur@example.test");
    const audit = await db.as(owner).rpc<Json[]>("admin_audit_log", { p_limit: 5 });
    expect(audit[0]).toMatchObject({ action: "reveal_email", actor: "Admin", target_id: p.id });
    // Un joueur n'a accès à rien de tout cela.
    await expectRpcError(db.as(p).rpc("admin_player_detail", { p_user: owner.id }), "E_FORBIDDEN");
    await expect(db.as(p).query(`select * from public.account_notices`)).rejects.toThrow();
  });
});
