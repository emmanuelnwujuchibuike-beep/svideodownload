/**
 * Repair streak counters that drifted away from their own ledger.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────
 *
 * `recordActivity` writes twice: an INSERT into `streak_daily_activity` (whose
 * composite primary key is what makes the daily credit idempotent) and then an
 * UPDATE of `streaks` behind a conditional guard. The ledger insert always
 * landed. The update sometimes did not, and its result was never checked — so
 * the day existed in the ledger and not in the counter, while
 * `last_activity_date` still moved forward.
 *
 * It could not self-heal: the old repair path only fired when
 * `lastActivityDate !== today`, so once the DATES agreed a wrong COUNT was
 * invisible for ever, and every following day added one to an already-wrong
 * number. Found in live data 2026-09-02 — e.g. streak e37b1759 with ten
 * consecutive ledger days against a `current_streak` of 4.
 *
 * `lib/streaks/engine.ts` now reconciles on the member's next visit. This does
 * the same repair for everyone at once, so nobody has to wait to be corrected.
 *
 * 🔴 IT ONLY EVER RAISES A STREAK, and only to a value the ledger proves. A
 * repair that could lower one would turn a bad read into lost progress.
 *
 *   node scripts/backfill-streak-counters.mjs            # dry run, prints only
 *   node scripts/backfill-streak-counters.mjs --apply    # writes
 */
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const head = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The trailing consecutive run ending at `today`. Mirrors calc.ts. */
function trailingRun(dates, today) {
  const unique = [...new Set(dates)].sort();
  if (!unique.length || unique[unique.length - 1] !== today) return 0;
  let run = 1;
  for (let i = unique.length - 1; i > 0; i--) {
    if (days(unique[i - 1], unique[i]) !== 1) break;
    run++;
  }
  return run;
}

/* PostgREST truncates at 1000 rows — page explicitly rather than trusting one
   request to have returned everything (a standing trap on this project). */
async function allStreaks() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(
      `${URL_BASE}/rest/v1/streaks?select=id,current_streak,longest_streak,total_active_days,streak_started_at,last_activity_date&order=id.asc&limit=1000&offset=${offset}`,
      { headers: head },
    );
    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

const rows = await allStreaks();
console.log(`scanned ${rows.length} streak rows\n`);

let suspect = 0;
let repaired = 0;
for (const row of rows) {
  if (!row.streak_started_at || !row.last_activity_date || row.current_streak <= 0) continue;
  const span = days(row.streak_started_at, row.last_activity_date);
  // The invariant every transition in applyActivity maintains.
  if (span < 0 || row.current_streak >= span + 1) continue;
  suspect++;

  const from = addDays(row.last_activity_date, -400);
  const c = await fetch(
    `${URL_BASE}/rest/v1/streak_daily_activity?select=activity_date&streak_id=eq.${row.id}` +
      `&gte.activity_date=${from}&order=activity_date.asc&limit=400`.replace("&gte.activity_date=", "&activity_date=gte."),
    { headers: head },
  );
  const dates = (await c.json()).map((d) => d.activity_date);
  const run = trailingRun(dates, row.last_activity_date);
  if (run <= row.current_streak) {
    console.log(`  ${row.id.slice(0, 8)}  invariant off but ledger agrees (${run}) — leaving alone`);
    continue;
  }

  const patch = {
    current_streak: run,
    longest_streak: Math.max(row.longest_streak, run),
    total_active_days: Math.max(row.total_active_days, new Set(dates).size),
    streak_started_at: addDays(row.last_activity_date, -(run - 1)),
  };
  console.log(
    `  ${row.id.slice(0, 8)}  current ${row.current_streak} -> ${patch.current_streak}  ` +
      `total ${row.total_active_days} -> ${patch.total_active_days}  started ${row.streak_started_at} -> ${patch.streak_started_at}`,
  );

  if (APPLY) {
    /* Guarded on the value we read, so a normal increment landing at the same
       moment wins instead of being clobbered. */
    const w = await fetch(
      `${URL_BASE}/rest/v1/streaks?id=eq.${row.id}&current_streak=eq.${row.current_streak}`,
      { method: "PATCH", headers: { ...head, Prefer: "return=minimal" }, body: JSON.stringify(patch) },
    );
    if (!w.ok) console.log(`     WRITE FAILED ${w.status} ${(await w.text()).slice(0, 200)}`);
    else repaired++;
  }
}

console.log(
  `\n${suspect} row(s) contradicted their own ledger.` +
    (APPLY ? `  ${repaired} repaired.` : "  DRY RUN — re-run with --apply to write."),
);
