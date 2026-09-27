import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EVENT_FEATURES, featureOf, __prefixRules } from "./features";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** The source with comments stripped, so a sentence ABOUT a thing cannot pass a test about doing it. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/0172_direct_event_ingest.sql";
/** 0173 supersedes both of 0172's functions and its read policy. */
const MIGRATION_173 = "supabase/migrations/0173_ingest_rls_scan_and_diagnostics.sql";
/** Every migration that defines part of the ingest path, for the ordering guard. */
const INGEST_MIGRATIONS = [MIGRATION, MIGRATION_173];

/**
 * The migration with its `--` comments removed.
 *
 * Load-bearing: this file documents the very traps it is guarded against, so a
 * sentence explaining why `p_user_id` must never appear would otherwise fail the
 * test asserting it never appears. Same shape as the `code()` helper the other
 * source guards in this repo use.
 */
const sqlCode = (s: string) => s.replace(/^\s*--.*$/gm, "");

/**
 * The SQL with every dollar-quoted region removed.
 *
 * A statement INSIDE a `do $$ … $$` block is not a statement at the file's top
 * level, so `alter publication …` in the Realtime block is legitimate while the
 * same line sitting bare after a `create function` would be the 0130 bug.
 */
const withoutDollarQuotes = (s: string) => s.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, "");

/**
 * The migration that took the Vercel function out of the analytics write path,
 * and the client that now writes without it.
 *
 * Every test here pins a property that is invisible at runtime until it is too
 * late: a grant that silently did not apply, an event category that stopped
 * reaching an admin section, an identity argument that would let anyone write as
 * anyone. None of them would fail a build or show up in a screenshot.
 */
describe("direct event ingest — the feature classifier", () => {
  it("routes every surface's events to its own section", () => {
    expect(featureOf("page_view")).toBe("traffic");
    expect(featureOf("page_exit")).toBe("traffic");
    expect(featureOf("session_start")).toBe("traffic");

    expect(featureOf("download_requested")).toBe("downloads");
    expect(featureOf("download_completed")).toBe("downloads");
    expect(featureOf("multilink_opened")).toBe("downloads");

    expect(featureOf("character_replace_result_viewed")).toBe("ai");
    expect(featureOf("lip_sync_generate_clicked")).toBe("ai");
    expect(featureOf("text_to_audio_generate_clicked")).toBe("ai");
    expect(featureOf("audio_library_reused")).toBe("ai");
    expect(featureOf("voice_clone_started")).toBe("ai");

    expect(featureOf("ad_impression")).toBe("ads");
    expect(featureOf("ad_click")).toBe("ads");
    expect(featureOf("vast_started")).toBe("ads");
    expect(featureOf("reward_completed")).toBe("ads");
    expect(featureOf("monetag_rendered")).toBe("ads");
    expect(featureOf("banner_filled")).toBe("ads");
    expect(featureOf("interstitial_click")).toBe("ads");

    expect(featureOf("pwa_installed")).toBe("pwa");
  });

  it("keeps a reward download in DOWNLOADS, not in ads", () => {
    /*
      A deliberate choice, and one worth pinning because it reads both ways. An
      operator asking "what is happening to downloads" wants the step where the
      unlock was abandoned; the ad itself is counted by the `ad_*` and `vast_*`
      events fired alongside. Folding these into `ads` would leave the downloads
      section unable to see the middle of its own funnel.
    */
    expect(featureOf("download_hd_reward_started")).toBe("downloads");
    expect(featureOf("download_batch_reward_cancelled")).toBe("downloads");
    expect(featureOf("download_preview_reward_granted")).toBe("downloads");
  });

  it("answers null rather than guessing", () => {
    // `custom` genuinely has no surface, and the 145,796 rows written before the
    // column existed are legitimately unclassified. A guessed bucket would be a
    // fabricated stat.
    expect(featureOf("custom")).toBeNull();
    expect(featureOf("something_nobody_declared")).toBeNull();
  });

  it("never lets an earlier prefix shadow a later one", () => {
    /*
      🔴 The ordering bug this file exists to prevent. `PREFIXES` is scanned in
      order and the first match wins, so a short prefix placed above a longer one
      that starts with it would silently swallow the longer rule — and the
      symptom is an entire surface's events classifying as the wrong section,
      which looks like that section being quiet rather than like a bug.
    */
    const rules = __prefixRules();
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const earlier = rules[i]![0];
        const later = rules[j]![0];
        expect(
          later.startsWith(earlier),
          `"${earlier}" (position ${i}) shadows "${later}" (position ${j}) — move the longer prefix above it`,
        ).toBe(false);
      }
    }
  });

  it("only ever returns a declared feature", () => {
    for (const [, feature] of __prefixRules()) {
      expect(EVENT_FEATURES).toContain(feature);
    }
  });
});

describe("direct event ingest — the migration's security properties", () => {
  const sql = src(MIGRATION);

  it("derives identity and never accepts it", () => {
    // The 0141 law: `security definer` + a p_user_id argument lets anyone write
    // as anyone. Both functions must read auth.uid() themselves.
    expect(sqlCode(sql)).not.toMatch(/p_user_id/);
    expect(sql).toMatch(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    // And the payload's own user_id must never be selected into the insert.
    expect(sqlCode(sql)).not.toMatch(/->>'user_id'/);
  });

  it("pins search_path on every security definer function", () => {
    for (const fn of sql.split(/create or replace function/).slice(1)) {
      if (!/security definer/.test(fn)) continue;
      expect(fn, "security definer without a pinned search_path").toMatch(/set search_path/);
    }
  });

  it("revokes from PUBLIC before granting, for both functions, in every migration that defines them", () => {
    /*
      Postgres grants EXECUTE to PUBLIC by default, so a grant alone would leave
      a wider grant sitting underneath the intended one.

      Checked in EVERY migration that touches these functions, not just the one
      that created them: `create or replace` preserves privileges, but a future
      edit that drops and recreates instead would take the browser's ability to
      record anything with it — silently, because the client swallows analytics
      failures by design.
    */
    for (const file of INGEST_MIGRATIONS) {
      const body = src(file);
      for (const fn of ["track_events", "track_download_state"]) {
        expect(body, `${file} redefines ${fn} without re-granting`).toContain(
          `grant execute on function public.${fn}(jsonb) to anon, authenticated`,
        );
        expect(body).toContain(`revoke all on function public.${fn}(jsonb) from public`);
      }
    }
  });

  it("puts the grants inside a dollar-quoted block, after the functions", () => {
    /*
      🔴 `0130_streaks.sql` silently skipped two trailing `alter table`
      statements that sat after a `create function`, and nothing reported an
      error for weeks. Here the stakes are worse than a missing column: a
      `revoke` that landed while its `grant` was skipped would leave every
      browser unable to record an event, and the client swallows analytics
      failures by design, so nothing would say so.

      So no bare DDL may appear after the first dollar-quote opens.
    */
    for (const file of INGEST_MIGRATIONS) {
    const one = src(file);
    const firstDollarQuote = one.search(/\$[a-z_]*\$/);
    expect(firstDollarQuote, `${file} has no dollar-quoted block`).toBeGreaterThan(0);
    /*
      Strip the dollar-quoted interiors FIRST. A `create function` body and the
      `alter publication` inside the Realtime `do` block are not top-level
      statements, and flagging them would make this test unpassable rather than
      strict. What is left is what Postgres would run as bare DDL.
    */
    const topLevel = sqlCode(withoutDollarQuotes(one));
    const afterFirst = topLevel.slice(topLevel.search(/create or replace function/));
    const bare = afterFirst
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(alter|drop|revoke|grant)\s/i.test(l));
    expect(bare, `plain DDL after a dollar-quote in ${file}:\n  ${bare.join("\n  ")}`).toEqual([]);
    }
  });

  it("lets only an admin read, and publishes for Realtime", () => {
    expect(sql).toMatch(/create policy analytics_events_admin_read/);
    expect(sql).toMatch(/using \(public\.is_admin\(\)\)/);
    // There must be no insert/update/delete policy — the functions are the door.
    expect(sql).not.toMatch(/for (insert|update|delete)/i);
    expect(sql).toContain("alter publication supabase_realtime add table public.analytics_events");
  });

  it("hoists the admin check out of the row filter (0173)", () => {
    /*
      🔴 MEASURED, NOT THEORISED. With `using (public.is_admin())` a plain
      `select event_id ... limit 5` on the ANON key answered
      `57014 canceling statement due to statement timeout`: the check reads as a
      per-row filter, so a non-admin scans the whole 145,796-row table looking
      for five rows that can never match. Nothing leaked — and any anonymous
      caller could make Postgres do that on demand, for free.

      The scalar subquery makes it an InitPlan, evaluated once, and the scan is
      never started. The parentheses are the entire fix.
    */
    const sql173 = src(MIGRATION_173);
    expect(sql173).toContain("using ((select public.is_admin()))");
    // And the un-hoisted form must not come back.
    expect(sqlCode(sql173)).not.toMatch(/using \(public\.is_admin\(\)\)/);
  });

  it("never swallows an error without saying so (0173)", () => {
    /*
      🔴 THE DEFECT THAT HID THE OTHER DEFECT. `when others then return 0` is
      right that analytics must not raise into a download, and wrong that it may
      do so in silence: a raised error and "nothing matched the WHERE" became the
      same observable answer, so `track_download_state` failed completely while
      reporting a plausible zero. Same shape as `push_delivery_log`, which wrote
      nothing for weeks behind a swallowed rejection while pushes kept arriving.

      Every handler must therefore raise a warning — which reaches the Postgres
      log and never the browser — before returning.
    */
    const sql173 = sqlCode(src(MIGRATION_173));
    const handlers = sql173.split(/when others then/).slice(1);
    expect(handlers.length, "0173 defines no exception handler").toBeGreaterThan(0);
    for (const h of handlers) {
      // the warning must come BEFORE the return in the same handler
      const upToReturn = h.slice(0, h.search(/return/));
      expect(upToReturn, `a handler returns without a warning:\n${h.slice(0, 200)}`).toMatch(/raise warning/);
    }
    // A warning, never an exception: re-raising would break the page.
    expect(sql173).not.toMatch(/raise exception/);
  });

  it("does not create a view over an RLS table", () => {
    /*
      A `user_events` view was drafted and removed. A Postgres view defaults to
      `security_invoker = false`, so it runs as its owner and BYPASSES the base
      table's RLS, and Supabase's default privileges grant select on new objects
      to anon — which would have published the whole event log through the very
      policy added here to prevent that.
    */
    expect(sql).not.toMatch(/create (or replace )?view/i);
  });

  it("guards every optional cast so one bad field cannot discard a batch", () => {
    /*
      Both functions end in `exception when others then return 0`, which is
      correct — analytics may never raise into the page. But it returns 0 for the
      WHOLE batch, so an unguarded cast on one event would silently drop the
      other 49.
    */
    // `\s+` between the tokens: the formatter wraps a long `case` onto its own
    // line, and a guard test that depends on line breaks fails on a reformat.
    expect(sql).toMatch(/case\s+when\s+e->>'download_id'\s*~/);
    expect(sql).toMatch(/case\s+when\s+e->>'occurred_at'\s*~/);
    expect(sql).toMatch(/case\s+when\s+r->>'file_size'\s*~/);
    expect(sql).toMatch(/case\s+when\s+r->>'duration_ms'\s*~/);
    expect(sql).toMatch(/case\s+when\s+r->>'last_event_at'\s*~/);
    // NOT NULL columns are checked for a value, not merely for a present key:
    // `e ? 'k'` is true when the value is JSON null.
    expect(sql).toContain("(e->>'visitor_id') is not null");
    expect(sql).toContain("(e->>'session_id') is not null");
  });
});

describe("direct event ingest — the client no longer pays Vercel", () => {
  it("sends events to Postgres, not to an API route", () => {
    const client = code("lib/analytics/client.ts");
    expect(client).toMatch(/postIngest\(\s*"track_events"/);
    expect(client).toMatch(/postIngest\(\s*"track_download_state"/);
    // The old ingest POST is gone. The only /api/ call left is the alert hop.
    expect(client).not.toMatch(/fetch\("\/api\/analytics\/collect"/);
  });

  it("calls the alert route only for terminal download events", () => {
    const client = code("lib/analytics/client.ts");
    expect(client).toMatch(/function reportOutcome/);
    // A plain completion must not alert — only one that needed retrying.
    expect(client).toMatch(/attempts > 1/);
    expect(client).toContain("alertsOnly: true");
  });

  it("the alert route stores nothing", () => {
    /*
      The whole point of the shrink. If a future edit reintroduces a write here,
      the same row is written twice — once by the browser and once by the route —
      which is the double-counting the brief's Phase 10 forbids, and
      `analytics_events` has no unique key that would catch it (the event_id
      would differ).
    */
    const route = code("app/api/analytics/collect/route.ts");
    expect(route).not.toMatch(/createAdminClient/);
    expect(route).not.toMatch(/\.from\("analytics_events"\)/);
    expect(route).not.toMatch(/\.from\("analytics_downloads"\)/);
    expect(route).not.toMatch(/\.upsert\(|\.insert\(/);
  });

  it("never sets the api key as a header a beacon cannot carry, without a fallback", () => {
    const ingest = code("lib/analytics/ingest.ts");
    // keepalive is what survives pagehide; it is the primary path.
    expect(ingest).toMatch(/keepalive: true/);
    // The beacon fallback has to put the key in the query string, because
    // sendBeacon cannot set headers at all.
    expect(ingest).toMatch(/apikey=\$\{encodeURIComponent\(ANON_KEY\)\}/);
  });

  it("clears the cached token on sign-out", () => {
    /*
      Otherwise a member signs out and their device keeps writing events under
      the identity that just left — which is both wrong and the kind of wrong
      nobody notices, because the rows look perfectly valid.
    */
    const ingest = code("lib/analytics/ingest.ts");
    expect(ingest).toMatch(/onAuthStateChange/);
    expect(ingest).toMatch(/accessToken = session\?\.access_token \?\? null/);
  });

  it("the context route logs nothing", () => {
    /*
      🔴 A log line IS an observability event. A route added during a migration
      to reduce them that printed one per call would hand back most of the
      saving — which is exactly what /api/vitals and /api/metrics/playback did,
      since a log line was their entire purpose.
    */
    // Comment-stripped: the route's own doc explains that it must not log,
    // and that sentence contains the word this asserts is absent.
    const route = code("app/api/analytics/context/route.ts");
    expect(route).not.toMatch(/console\./);
    // Edge, not node: the cheapest invocation with the smallest log footprint.
    expect(route).toContain('export const runtime = "edge"');
    // It must stay a pure header read — no database, no session.
    expect(route).not.toMatch(/createClient|createAdminClient|supabase/i);
  });
});
