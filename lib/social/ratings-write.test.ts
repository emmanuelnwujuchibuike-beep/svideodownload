import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the app-ratings WRITE path against the exact regression that silently
 * discarded every rating ever submitted (fixed 2026-08-23).
 *
 * ── Why this asserts on source text rather than behaviour ─────────────────────
 * The bug was a database-level rejection: migration 0111 dedupes with two
 * PARTIAL unique indexes, PostgreSQL can only infer a partial index for
 * `ON CONFLICT` when the statement repeats the index's WHERE predicate, and
 * PostgREST cannot send one — so `upsert(..., { onConflict })` raised 42P10 on
 * every single write. Reproducing that in a unit test would mean standing up a
 * real Postgres with the real indexes; mocking the client would just assert
 * that our mock returns what we told it to, and would have passed happily
 * against the broken code.
 *
 * What CAN be checked cheaply and meaningfully is that the dangerous
 * construction has not come back. `upsert` on this table looks tidier than the
 * find-then-write it replaced, which is exactly why someone would reintroduce
 * it — and the failure is invisible: the endpoint still returns 200, the admin
 * email still arrives, and only the dashboard stays mysteriously empty.
 *
 * Same technique the landing-page budget test uses for framer-motion: assert on
 * the artifact, because reading the code is what missed it the first time.
 */

const ROUTE = join(process.cwd(), "app", "api", "ratings", "route.ts");

describe("app_ratings write path", () => {
  it("does not use upsert/onConflict, which cannot infer 0111's partial indexes", () => {
    const src = readFileSync(ROUTE, "utf8");
    // Strip block comments so the explanatory note above the fix — which names
    // `upsert` and `onConflict` on purpose — cannot trip its own guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(
      /\.upsert\s*\(/.test(code),
      "app/api/ratings/route.ts calls .upsert() again. Migration 0111 dedupes with " +
        "PARTIAL unique indexes, so ON CONFLICT raises 42P10 and EVERY rating is " +
        "silently dropped — the endpoint still returns 200 and the admin email still " +
        "sends, so nothing looks broken except an empty dashboard. Use the " +
        "find-then-update/insert path instead.",
    ).toBe(false);

    expect(
      /onConflict/.test(code),
      "app/api/ratings/route.ts references onConflict again — see the note above.",
    ).toBe(false);
  });

  it("still writes to app_ratings and reports whether the row was stored", () => {
    const src = readFileSync(ROUTE, "utf8");
    // The guard above is only meaningful if the route is still the writer; a
    // future refactor that moves the write elsewhere should update this test
    // rather than leave it passing vacuously.
    expect(src).toContain('from("app_ratings")');
    expect(src).toContain("stored");
  });
});
