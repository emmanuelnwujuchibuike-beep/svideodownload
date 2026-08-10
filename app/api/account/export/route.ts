import { NextResponse } from "next/server";

import { PORTABILITY, restrictedDomains } from "@/lib/portability/registry";
import { exportPlan, FOLLOW_MIRROR } from "@/lib/portability/tables";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account/export — "Download my data".
 *
 * ── What this used to be, and why it had to change ───────────────────────────
 * It hand-listed nine tables: profiles, posts, post_comments, follows, blocks,
 * muted_creators, privacy_settings and the audit log. The schema has
 * ninety-four in the personal domains alone.
 *
 * So the export was never WRONG — it was silently incomplete, and getting worse
 * on its own. Every table added since was absent from it, and nothing failed:
 * not a type, not a test, not a lint rule. Somebody exercising their right to a
 * copy of their data received a file that looked whole, and neither they nor we
 * had any way to know what was missing from it. That is a compliance problem
 * (GDPR Art. 20 is about ALL the personal data concerning the subject) before it
 * is an engineering one, and "we forgot the table" is not a defence.
 *
 * The table list now comes from `exportPlan()`, which is derived from the domain
 * catalogue that `data-domains.test.ts` already refuses to let drift. A new
 * table in a catalogued domain reaches this route with no edit here at all —
 * and `tables.test.ts` fails until somebody decides whether it belongs in the
 * export or writes down why it does not.
 *
 * ── The file reports its own completeness ────────────────────────────────────
 * `coverage` lists what was included, what was withheld and the reason for each
 * withholding, in the same file. A gap somebody can read is a completely
 * different thing from a gap they cannot: it turns "is this everything?" from
 * an act of faith into something checkable.
 *
 * ── One failing table must not cost the whole export ─────────────────────────
 * Seventy-plus queries run here. A missing table on a deploy where a migration
 * has not been applied, or a permission problem on one of them, previously
 * would have rejected the whole `Promise.all` and returned nothing. Each read
 * now settles independently and a failure is REPORTED in `coverage.failed`
 * rather than swallowed — an export that quietly omits a section it meant to
 * include is the exact failure mode this rewrite exists to end.
 */

/** Read in batches so a hundred-table export does not open a hundred sockets. */
const BATCH = 8;

interface TableResult {
  table: string;
  rows: unknown[] | null;
  error?: string;
}

async function readTable(
  db: ReturnType<typeof createAdminClient>,
  table: string,
  column: string,
  userId: string,
  key = table,
): Promise<TableResult> {
  try {
    const { data, error } = await db.from(table).select("*").eq(column, userId).limit(5000);
    if (error) return { table: key, rows: null, error: error.message };
    return { table: key, rows: data ?? [] };
  } catch (e) {
    return { table: key, rows: null, error: e instanceof Error ? e.message : "unknown error" };
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const db = createAdminClient();
  const plan = exportPlan();

  const reads: { table: string; column: string; key: string }[] = plan.included.map((t) => ({
    table: t.table,
    column: t.column,
    key: t.table,
  }));
  /* The one table read from both sides — who you follow, and who follows you.
     Both are facts about you and both are already visible to you in the app. */
  reads.push({ table: FOLLOW_MIRROR.table, column: FOLLOW_MIRROR.column, key: FOLLOW_MIRROR.as });

  const results: TableResult[] = [];
  for (let i = 0; i < reads.length; i += BATCH) {
    const slice = reads.slice(i, i + BATCH);
    results.push(...(await Promise.all(slice.map((r) => readTable(db, r.table, r.column, user.id, r.key)))));
  }

  const data: Record<string, unknown[]> = {};
  const failed: { table: string; error: string }[] = [];
  for (const r of results) {
    if (r.rows) data[r.table] = r.rows;
    else failed.push({ table: r.table, error: r.error ?? "unknown error" });
  }

  const payload = {
    /*
      A stated format version. An export is a file somebody may still have in
      five years, and a reader — ours or a competitor's importer — needs to know
      what shape it is looking at without guessing from the keys present.
    */
    format: "frenzsave.account-export",
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null },

    /*
      The honesty section. Everything a reader needs to judge what they have:
      what came back, what was deliberately left out and why, what is personal
      but not handed over in bulk and why, and anything that failed to read.
    */
    coverage: {
      included: plan.included.map((t) => t.table),
      excluded: plan.excluded,
      withheldDomains: restrictedDomains().map(({ domain, spec }) => ({
        domain: domain.name,
        reason: spec.withheldBecause,
      })),
      failed,
      note:
        "Sections are named after the tables they came from. Anything listed under `excluded` or `withheldDomains` is not in this file, and the reason is stated beside it.",
    },

    /*
      What every part of this file is for, in plain language, straight from the
      registry the Transparency Dashboard renders. Somebody reading an export
      six months from now should not have to guess what a table was doing.
    */
    about: PORTABILITY.map((p) => ({
      area: p.domain,
      holds: p.holds,
      whyWeHaveIt: p.purpose,
      howLongWeKeepIt: p.retention,
    })),

    data,
  };

  return NextResponse.json(payload, {
    headers: {
      "Content-Disposition": `attachment; filename="frenz-data-export-${user.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
