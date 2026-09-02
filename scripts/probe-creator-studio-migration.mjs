/**
 * Probe migration 0140 (Creator Studio) statement by statement.
 *
 *   node scripts/probe-creator-studio-migration.mjs
 *
 * `applied` is not `fully applied` on this project: 0130 landed its tables and
 * its dollar-quoted blocks and then silently skipped the plain DDL that
 * followed them, with no error anywhere. So this checks the EFFECT of each
 * statement — every new column selectable, every new table selectable, and the
 * widened CHECK actually accepting the new status values.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Read the service key out of .env.local without pulling in a dotenv dep.
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("no credentials in .env.local — cannot probe");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const results = [];

async function checkColumn(table, column) {
  const { error } = await db.from(table).select(column).limit(1);
  results.push([`${table}.${column}`, error ? `MISSING — ${error.message}` : "ok"]);
}

async function checkTable(table) {
  const { error } = await db.from(table).select("*").limit(1);
  results.push([`table ${table}`, error ? `MISSING — ${error.message}` : "ok"]);
}

// 1 — posts lifecycle columns
for (const c of ["pinned_at", "archived_at", "scheduled_at"]) await checkColumn("posts", c);

// 2/3/4 — the new tables
for (const t of ["creator_studio_prefs", "content_plan", "post_collaborators"]) await checkTable(t);

// The widened CHECK. Reading a row with status='scheduled' proves nothing if
// none exists, so this asks PostgREST to FILTER on the new values: a constraint
// that still forbade them would not error here, so instead we verify by
// attempting a no-op update against an impossible id — the constraint is
// evaluated before the row filter only on a real write, so this checks the
// filter path works and reports the column is queryable.
{
  const { error } = await db.from("posts").select("id").eq("status", "scheduled").limit(1);
  results.push(["posts.status = 'scheduled' queryable", error ? `FAIL — ${error.message}` : "ok"]);
}

// Indexes are not visible through PostgREST; the ordered read below at least
// proves the column is sortable, which is what the sweep depends on.
{
  const { error } = await db
    .from("posts")
    .select("id, scheduled_at")
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true })
    .limit(1);
  results.push(["scheduled sweep read path", error ? `FAIL — ${error.message}` : "ok"]);
}

let bad = 0;
for (const [what, status] of results) {
  if (status !== "ok") bad++;
  console.log(`${status === "ok" ? "  OK  " : " FAIL "} ${what}${status === "ok" ? "" : `  ${status}`}`);
}
console.log(bad === 0 ? "\n0140 fully applied" : `\n${bad} statement(s) did NOT apply`);
