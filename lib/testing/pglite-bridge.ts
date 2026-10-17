import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { FakeDb } from "@/lib/testing/fake-supabase";

/**
 * A test-only bridge: the in-memory Supabase stand-in (fake-supabase) for TABLE reads and writes, and a
 * real Postgres (PGlite) running the REAL migration SQL for every RPC. Before an RPC the PGlite tables
 * are made equal to the fake's rows; after it, the fake's rows are made equal to PGlite's. So a journey
 * test drives the real route handlers and the real money functions (settle, withdraw, resolve, …)
 * against one consistent state — closer to production than scripted RPC stand-ins.
 *
 * What it is NOT: PostgREST, RLS or grants (the server uses the service role, which bypasses both;
 * those are proven in supabase/tests/*.pglite.mjs). One connection: no concurrency (see
 * supabase/tests/sub_concurrency.pg.mjs for that).
 *
 * PGlite is not a repo dependency (the database harnesses run it from %TEMP%). It is looked for in
 * PGLITE_DIR, then node_modules, then the system temp folder; `null` when absent, and the caller skips.
 */
interface PGliteLike {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}
type PGliteCtor = new () => PGliteLike;

export async function loadPGlite(): Promise<PGliteCtor | null> {
  const dirs = [process.env.PGLITE_DIR, join(process.cwd(), "node_modules/@electric-sql/pglite"), join(tmpdir(), "node_modules/@electric-sql/pglite")].filter((d): d is string => !!d);
  for (const dir of dirs) {
    const entry = join(dir, "dist/index.js");
    if (existsSync(entry)) return ((await import(/* @vite-ignore */ pathToFileURL(entry).href)) as { PGlite: PGliteCtor }).PGlite;
  }
  return null;
}

/** The PGlite stub schema of the SUB invariants harness (one source for the tables both test). */
export function subHarnessStub(): string {
  const h = readFileSync(join(process.cwd(), "supabase/tests/sub_financial_invariants.pglite.mjs"), "utf8");
  const a = h.indexOf("const stub = `") + "const stub = `".length;
  return h.slice(a, h.indexOf("`;", a));
}

type Col = { name: string; type: string; identityAlways: boolean };

export async function createSqlBridge(PGlite: PGliteCtor, db: FakeDb, opts: { setup: string[]; migrations: string[]; userIds: string[] }) {
  const pg = new PGlite();
  for (const sql of opts.setup) await pg.exec(sql);
  await pg.exec(`insert into auth.users (id) values ${opts.userIds.map((u) => `('${u}')`).join(", ")}`);
  for (const f of opts.migrations) await pg.exec(readFileSync(join(process.cwd(), "supabase/migrations", f), "utf8"));

  const tables = (await pg.query<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).rows.map((r) => r.t);
  const cols = new Map<string, Col[]>();
  for (const t of tables) {
    const rows = (await pg.query<{ name: string; type: string; ident: string | null }>("select column_name as name, data_type as type, identity_generation as ident from information_schema.columns where table_schema = 'public' and table_name = $1", [t])).rows;
    cols.set(t, rows.map((r) => ({ name: r.name, type: r.type, identityAlways: r.ident === "ALWAYS" })));
  }
  const toSql = (v: unknown, type: string) => (v !== null && v !== undefined && (type === "jsonb" || type === "json") && typeof v !== "string" ? JSON.stringify(v) : v);
  const fromSql = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : v);

  /** PGlite := fake (triggers and FK checks off while copying: the rows already happened) */
  const push = async () => {
    await pg.exec("set session_replication_role = replica");
    try {
      for (const t of tables) {
        await pg.exec(`delete from public.${t}`);
        const tc = cols.get(t)!;
        for (const row of db.tables[t] ?? []) {
          // the fake gives every inserted row a uuid `id`; a bigint identity column numbers its own
          const present = tc.filter((c) => row[c.name] !== undefined && !(/^(bigint|integer|smallint)$/.test(c.type) && typeof row[c.name] === "string" && !/^-?\d+$/.test(row[c.name] as string)));
          if (!present.length) continue;
          const over = present.some((c) => c.identityAlways) ? " overriding system value" : "";
          await pg.query(`insert into public.${t} (${present.map((c) => `"${c.name}"`).join(", ")})${over} values (${present.map((_, i) => `$${i + 1}`).join(", ")})`, present.map((c) => toSql(row[c.name], c.type)));
        }
      }
    } finally {
      await pg.exec("set session_replication_role = origin");
    }
  };
  /** fake := PGlite */
  const pull = async () => {
    for (const t of tables) {
      const rows = (await pg.query<Record<string, unknown>>(`select * from public.${t}`)).rows;
      db.tables[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fromSql(v)])));
    }
  };

  const procs = (await pg.query<{ n: string }>("select distinct p.proname as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prokind = 'f'")).rows.map((r) => r.n);
  for (const name of procs) {
    db.rpc[name] = async (args) => {
      await push();
      const keys = Object.keys(args);
      try {
        const res = await pg.query<{ r: unknown }>(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => { const v = args[k]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; }));
        await pull();
        return { data: fromSql(res.rows[0]?.r ?? null), error: null };
      } catch (e) {
        await pull();
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    };
  }
  /** Run SQL against the current state (a test's own check), then bring the fake up to date. */
  const sql = async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
    await push();
    const out = (await pg.query<T>(text, params)).rows;
    await pull();
    return out;
  };
  return { pg, push, pull, sql, close: () => pg.close() };
}
