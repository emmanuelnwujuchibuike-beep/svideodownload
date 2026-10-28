import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";
import { createSqlBridge, loadPGlite } from "@/lib/testing/pglite-bridge";

/**
 * The PGlite bridge (2026-10-27): only tables whose fake rows changed since the last sync are rewritten before an RPC.
 * Root cause it fixes: every RPC used to delete and re-insert EVERY row of EVERY table one statement at a time, so a
 * journey's later steps grew slower with its whole history (bundles step 4: 4.0 s alone of a 5 s budget) and timed out
 * under the full suite. These pin that the sync is still CORRECT both ways (a change made on either side is seen by the
 * other) while unchanged tables are skipped. Skips when PGlite isn't installed (lib/testing/pglite-bridge.ts).
 */
const PGlite = await loadPGlite();
let db: FakeDb;
let bridge: Awaited<ReturnType<typeof createSqlBridge>>;
const U = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  if (!PGlite) return;
  db = fakeDb({ counters: [], notes: [], untouched: [{ id: "x", v: 1 }] });
  bridge = await createSqlBridge(PGlite, db, {
    setup: [
      "create schema auth",
      "create table auth.users (id uuid primary key)",
      "create table public.counters (id text primary key, n integer not null)",
      "create table public.notes (id text primary key, body text)",
      "create table public.untouched (id text primary key, v integer)",
      "create function public.bump(p_id text) returns integer language sql as $$ insert into public.counters (id, n) values (p_id, 1) on conflict (id) do update set n = public.counters.n + 1 returning n $$",
      "create function public.count_notes() returns integer language sql as $$ select count(*)::int from public.notes $$",
    ],
    migrations: [],
    userIds: [U],
  });
}, 60_000);
afterAll(async () => {
  await bridge?.close();
});

describe.skipIf(!PGlite)("pglite-bridge: incremental sync", () => {
  it("an RPC's writes come back to the fake", async () => {
    const r = await db.rpc.bump!({ p_id: "a" });
    expect(r).toEqual({ data: 1, error: null });
    expect(db.tables.counters).toEqual([{ id: "a", n: 1 }]);
  });
  it("a change made on the fake side is pushed before the next RPC (and seen by it)", async () => {
    db.tables.notes!.push({ id: "n1", body: "hello" }, { id: "n2", body: "world" });
    expect((await db.rpc.count_notes!({})).data).toBe(2);
    db.tables.counters![0]!.n = 41;
    expect((await db.rpc.bump!({ p_id: "a" })).data).toBe(42);
  });
  it("a removal on the fake side is pushed too", async () => {
    db.tables.notes = db.tables.notes!.filter((n) => n.id !== "n1");
    expect((await db.rpc.count_notes!({})).data).toBe(1);
  });
  it("tables nobody changed are not rewritten", async () => {
    const before = bridge.stats();
    await db.rpc.count_notes!({});
    await db.rpc.count_notes!({});
    const after = bridge.stats();
    expect(after.pushedTables - before.pushedTables).toBe(0);
    expect(after.skippedTables - before.skippedTables).toBe(after.tables * 2);
    expect(db.tables.untouched).toEqual([{ id: "x", v: 1 }]);
  });
  it("a test's own SQL sees the current fake state and refreshes it", async () => {
    db.tables.notes!.push({ id: "n3", body: "!" });
    const rows = await bridge.sql<{ n: number }>("select count(*)::int n from public.notes");
    expect(rows[0]!.n).toBe(2);
  });
});
