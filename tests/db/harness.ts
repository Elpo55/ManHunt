/**
 * Harnais de test base de données : Postgres réel (PGlite / WASM) avec les
 * migrations du projet appliquées sur des stubs Supabase (auth, realtime).
 *
 * - `db.as(user)` exécute les requêtes avec le rôle `authenticated` et le JWT
 *   de l'utilisateur, exactement comme un client Supabase : la RLS s'applique.
 * - `db.setNow(date)` pilote l'horloge serveur (private.now_()).
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const ROOT = join(HERE, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

export interface TestUser {
  id: string;
  name: string;
}

export interface RpcError {
  code: string;
  detail?: string;
}

export class TestDb {
  private constructor(public pg: PGlite) {}
  private nowIso: string | null = null;

  static async create(): Promise<TestDb> {
    const pg = new PGlite();
    await pg.exec(readFileSync(join(HERE, "supabase-stubs.sql"), "utf8"));
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      try {
        await pg.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
      } catch (e) {
        throw new Error(`Migration ${f} échouée : ${(e as Error).message}`);
      }
    }
    // Horloge pilotable pour les tests uniquement.
    await pg.exec(`
      create or replace function private.now_() returns timestamptz language sql stable set search_path = '' as $$
        select coalesce(nullif(current_setting('test.now', true), '')::timestamptz, now())
      $$;
    `);
    const db = new TestDb(pg);
    await db.setNow(new Date("2026-06-01T12:00:00Z"));
    return db;
  }

  async setNow(d: Date) {
    this.nowIso = d.toISOString();
    await this.pg.query(`select set_config('test.now', $1, false)`, [this.nowIso]);
  }

  async advance(ms: number) {
    const cur = this.nowIso ? new Date(this.nowIso) : new Date();
    await this.setNow(new Date(cur.getTime() + ms));
  }

  now(): Date {
    return new Date(this.nowIso!);
  }

  /** Crée un utilisateur (invité par défaut) avec un pseudo valide. */
  async createUser(name: string, opts: { anonymous?: boolean } = {}): Promise<TestUser> {
    await this.pg.query("reset role");
    const r = await this.pg.query<{ id: string }>(
      `insert into auth.users (email, is_anonymous) values ($1, $2) returning id`,
      [opts.anonymous === false ? `${name.toLowerCase()}@example.test` : null, opts.anonymous !== false],
    );
    const id = r.rows[0].id;
    await this.as({ id, name }).rpc("update_my_profile", { p_username: name, p_avatar: "orbit:azure" });
    return { id, name };
  }

  /** Exécution en tant que superutilisateur (contourne la RLS). */
  async sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    await this.pg.query("reset role");
    await this.pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
    const r = await this.pg.query<T>(query, params);
    return r.rows;
  }

  as(user: TestUser) {
    const pg = this.pg;
    const enter = async () => {
      await pg.query("reset role");
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user.id]);
      await pg.query("set role authenticated");
    };
    const leave = async () => {
      await pg.query("reset role");
    };
    return {
      /** Appelle une fonction RPC publique ; lève RpcError en cas d'erreur métier. */
      rpc: async <T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
        const keys = Object.keys(args);
        const placeholders = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
        const values = keys.map((k) => {
          const v = args[k];
          return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        });
        await enter();
        try {
          const r = await pg.query<{ result: T }>(`select public.${fn}(${placeholders}) as result`, values);
          const result = r.rows[0]?.result as T;
          // Convention : certaines RPC renvoient {"error": "E_..."} (cf. join_room).
          const maybeErr = result as { error?: string } | null;
          if (maybeErr && typeof maybeErr === "object" && typeof maybeErr.error === "string") {
            throw { code: maybeErr.error } satisfies RpcError;
          }
          return result;
        } catch (e) {
          if (e && typeof e === "object" && "code" in e && !("message" in e)) throw e;
          const err = e as { message: string; detail?: string };
          const rpcErr: RpcError = { code: err.message, detail: err.detail };
          throw rpcErr;
        } finally {
          await leave();
        }
      },
      /** Requête SQL brute sous le rôle authenticated (RLS active). */
      query: async <T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> => {
        await enter();
        try {
          const r = await pg.query<T>(query, params);
          return r.rows;
        } finally {
          await leave();
        }
      },
      /** Simule l'autorisation Realtime : peut-on lire ce topic ? */
      canRead: async (topic: string, extension = "broadcast"): Promise<boolean> => {
        await pg.query("reset role");
        await pg.query(`select set_config('realtime.topic', $1, false)`, [topic]);
        await pg.query(`delete from realtime.messages where topic = $1 and event = '__probe__'`, [topic]);
        await pg.query(
          `insert into realtime.messages (topic, extension, event, payload) values ($1, $2, '__probe__', '{}')`,
          [topic, extension],
        );
        await enter();
        try {
          const r = await pg.query<{ n: number }>(
            `select count(*)::int as n from realtime.messages where topic = $1 and event = '__probe__'`,
            [topic],
          );
          return r.rows[0].n > 0;
        } finally {
          await leave();
          await pg.query(`delete from realtime.messages where event = '__probe__'`);
        }
      },
    };
  }

  /** Messages Realtime diffusés sur un topic (ordre chronologique). */
  async broadcasts(topic: string): Promise<{ event: string; payload: { t: string; sn?: number; d: unknown } }[]> {
    return this.sql(`select event, payload from realtime.messages where topic = $1 and event <> '__probe__' order by id`, [
      topic,
    ]);
  }

  async clearBroadcasts() {
    await this.sql(`delete from realtime.messages`);
  }
}

export async function expectRpcError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const err = e as RpcError;
    if (err.code !== code) {
      throw new Error(`Erreur attendue ${code}, reçue ${err.code} (${err.detail ?? ""})`);
    }
    return;
  }
  throw new Error(`Erreur attendue ${code}, mais l'appel a réussi`);
}
