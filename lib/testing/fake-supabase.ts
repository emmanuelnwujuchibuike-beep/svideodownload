/**
 * An in-memory stand-in for the service-role Supabase client, for behavioural tests of
 * server modules (Frenz Exclusive Part 2). It mirrors the PostgREST chain the code calls —
 * a THENABLE builder, so `await db.from(t).select().eq()` resolves `{ data, error, count }`
 * exactly like the real client (see lib/downloads/multi-link.server.test.ts for why that
 * matters) — and keeps a log of every write so a test can assert on what was NOT done.
 *
 * Deliberately small: equality-style filters, ordering, limits, counts, unique keys (an
 * insert that collides answers `{ error: { code: "23505" } }`), one embedded `!inner` join,
 * and scripted RPCs. `.or()` is accepted and ignored: tests put only the relevant rows in a
 * table that is read through it (`blocks`). Column lists are ignored: rows come back whole,
 * so a test asserts on what the CODE UNDER TEST passes on, not on what the fake returns.
 */

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** table name → column lists that must be unique together */
  unique: Record<string, string[][]>;
  rpc: Record<string, (args: Row) => Result | Promise<Result>>;
  writes: { table: string; op: "insert" | "update" | "upsert" | "delete"; values?: unknown; filters: string[] }[];
  /** table → column defaults applied on insert (what Postgres would fill in) */
  defaults: Record<string, Row>;
  /** table → message: every query on it answers this error (a missing column, an outage) */
  failOn: Record<string, string>;
  client: () => unknown;
}

/** Splits a PostgREST logic expression at its top-level commas. */
function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of expr) {
    if (ch === "\"") quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function termPredicate(term: string): (r: Record<string, unknown>) => boolean {
  const t = term.trim();
  const group = t.match(/^(and|or)\((.*)\)$/);
  if (group) {
    const parts = splitTop(group[2]!).map(termPredicate);
    return group[1] === "and" ? (r) => parts.every((p) => p(r)) : (r) => parts.some((p) => p(r));
  }
  const m = t.match(/^([\w.]+)\.(eq|neq|lt|lte|gt|gte)\.(.*)$/);
  if (!m) throw new Error(`fake-supabase: unsupported filter term ${t}`);
  const [, col, op, rawV] = m as unknown as [string, string, string, string];
  const v = rawV.startsWith("\"") && rawV.endsWith("\"") ? rawV.slice(1, -1) : rawV;
  return (r) => {
    const x = String(r[col] ?? "");
    return op === "eq" ? x === v : op === "neq" ? x !== v : op === "lt" ? x < v : op === "lte" ? x <= v : op === "gt" ? x > v : x >= v;
  };
}

const orPredicate = (expr: string) => {
  const parts = splitTop(expr).map(termPredicate);
  return (r: Record<string, unknown>) => parts.some((p) => p(r));
};

export function fakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = { tables: { ...seed }, unique: {}, defaults: {}, rpc: {}, writes: [], failOn: {}, client: () => client };
  const rows = (t: string) => (db.tables[t] ??= []);

  function builder(table: string) {
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let values: Row[] = [];
    let patch: Row = {};
    let head = false;
    let wantCount = false;
    let single: "one" | "maybe" | null = null;
    let embed: { table: string; cols: string } | null = null;
    let returning = false;
    let onConflict: string[] | null = null;
    let ignoreDuplicates = false;
    const preds: ((r: Row) => boolean)[] = [];
    const filters: string[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let limit: number | null = null;

    // "a.b" reads an embedded row; "a->>b" reads a JSON column's key as PostgREST does
    const val = (r: Row, col: string) => (col.includes("->>") ? (r[col.split("->>")[0]!] as Row | undefined)?.[col.split("->>")[1]!] : col.includes(".") ? (r[col.split(".")[0]!] as Row | undefined)?.[col.split(".")[1]!] : r[col]);
    const add = (desc: string, p: (r: Row) => boolean) => (filters.push(desc), preds.push(p), b);
    const b: Record<string, unknown> = {
      select(cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
        head = !!opts?.head;
        wantCount = !!opts?.count;
        const m = cols?.match(/(\w+)!inner\(([^)]*)\)/);
        if (m) embed = { table: m[1]!, cols: m[2]! };
        return b;
      },
      insert(v: Row | Row[]) { op = "insert"; values = Array.isArray(v) ? v : [v]; return b; },
      upsert(v: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) { op = "upsert"; values = Array.isArray(v) ? v : [v]; onConflict = o?.onConflict?.split(",") ?? null; ignoreDuplicates = !!o?.ignoreDuplicates; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      delete() { op = "delete"; return b; },
      eq: (c: string, v: unknown) => add(`${c}=${String(v)}`, (r) => val(r, c) === v),
      neq: (c: string, v: unknown) => add(`${c}!=${String(v)}`, (r) => val(r, c) !== v),
      in: (c: string, v: unknown[]) => add(`${c} in`, (r) => v.includes(val(r, c))),
      is: (c: string, v: unknown) => add(`${c} is ${String(v)}`, (r) => (val(r, c) ?? null) === v),
      gt: (c: string, v: string) => add(`${c}>`, (r) => String(val(r, c) ?? "") > v),
      gte: (c: string, v: string) => add(`${c}>=`, (r) => String(val(r, c) ?? "") >= v),
      lt: (c: string, v: string) => add(`${c}<`, (r) => String(val(r, c) ?? "") < v),
      lte: (c: string, v: string) => add(`${c}<=`, (r) => String(val(r, c) ?? "") <= v),
      not: (c: string, _o: string, v: unknown) => add(`${c} not`, (r) => (val(r, c) ?? null) !== v),
      contains: (c: string, v: Row) => add(`${c} @>`, (r) => Object.entries(v).every(([k, x]) => (r[c] as Row | undefined)?.[k] === x)),
      // PostgREST logic trees: "a.lt.x,and(b.eq.y,c.lt.z)" — evaluated for real, so keyset cursors and blocks are tested
      or: (expr: string) => add(`or(${expr})`, orPredicate(expr)),
      order: (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((limit = n), b),
      range: (from: number, to: number) => ((limit = to - from + 1), b),
      maybeSingle: () => ((single = "maybe"), b),
      single: () => ((single = "one"), b),
      then(res: (r: Result) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve().then(run).then(res, rej);
      },
    };

    function matching(): Row[] {
      let out = rows(table).map((r) => (embed ? { ...r, [embed.table]: rows(embed.table).find((e) => e.id === r.post_id) ?? null } : r));
      if (embed) out = out.filter((r) => r[embed!.table]);
      return out.filter((r) => preds.every((p) => p(r)));
    }

    function run(): Result {
      if (db.failOn[table]) return { data: null, error: { message: db.failOn[table]! } };
      if (op === "insert" || op === "upsert") {
        db.writes.push({ table, op, values, filters });
        const keys = op === "upsert" && onConflict ? [onConflict] : (db.unique[table] ?? []);
        const inserted: Row[] = [];
        for (const v of values) {
          const clash = rows(table).find((r) => keys.some((k) => k.every((c) => r[c] === v[c])));
          if (clash) {
            if (op === "upsert" && !ignoreDuplicates) Object.assign(clash, v);
            else if (op === "insert") return { data: null, error: { message: "duplicate key", code: "23505" } };
            continue;
          }
          const row = { id: v.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...db.defaults[table], ...v };
          rows(table).push(row);
          inserted.push(row);
        }
        return finish(inserted);
      }
      if (op === "update") {
        const hit = matching();
        db.writes.push({ table, op, values: patch, filters });
        for (const r of hit) Object.assign(rows(table).find((x) => x === r || x.id === r.id) ?? r, patch);
        return finish(hit);
      }
      if (op === "delete") {
        const hit = matching();
        db.writes.push({ table, op, filters });
        db.tables[table] = rows(table).filter((r) => !hit.some((h) => h === r || (h.id !== undefined && h.id === r.id)));
        return finish(hit);
      }
      let out = matching();
      if (orders.length) {
        out = [...out].sort((a, z) => {
          for (const { col, asc } of orders) {
            const x = String(a[col] ?? "");
            const y = String(z[col] ?? "");
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
      }
      const count = out.length;
      if (limit !== null) out = out.slice(0, limit);
      if (head) return { data: null, error: null, count };
      return finish(out, wantCount ? count : undefined);
    }

    function finish(out: Row[], count?: number): Result {
      if (op !== "select" && !returning) return { data: null, error: null };
      if (single === "one") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: "not one row" } };
      if (single === "maybe") return { data: out[0] ?? null, error: null };
      return { data: out, error: null, ...(count !== undefined ? { count } : {}) };
    }

    return b;
  }

  const client = {
    from: (t: string) => builder(t),
    rpc: async (name: string, args: Row) => {
      const h = db.rpc[name];
      if (!h) return { data: null, error: { message: `rpc ${name} not scripted` } };
      return h(args);
    },
  };
  return db;
}
