/**
 * Backfill descriptive SEO slugs (migration 0126) for existing posts.
 *
 * Only categorized, published, public posts get one — an uncategorized post
 * has nowhere principled to live at /[category]/[year]/[month]/[slug] and
 * keeps /p/[id] as its permanent canonical (see lib/social/post-url.ts).
 * Assigned once here and never regenerated later even if the title changes —
 * a stable URL matters more than staying in sync with a later edit, same
 * rule new posts get at publish time (lib/social/posts.ts's publishPost).
 *
 * Slug shape mirrors lib/social/post-url.ts's `slugifyTitle` exactly (that
 * file is TypeScript and this is a plain .mjs script per this repo's backfill
 * convention, so the ~10 lines are duplicated rather than imported — see any
 * other scripts/backfill-*.mjs for the same pattern).
 *
 * Usage:
 *   node scripts/backfill-post-slugs.mjs --dry
 *   node scripts/backfill-post-slugs.mjs
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function slugifyTitle(title, id) {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  const suffix = id.replace(/-/g, "").slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}

async function run() {
  const { data, error } = await db
    .from("posts")
    .select("id, title, category, slug")
    .eq("status", "published")
    .eq("visibility", "public")
    .not("category", "is", null)
    .is("slug", null);

  if (error) {
    // 42703 = column doesn't exist yet — migration 0126 hasn't been applied.
    console.log(`query failed (${error.code}: ${error.message}) — has migration 0126 been applied?`);
    return;
  }

  console.log(`${data.length} categorized post(s) with no slug yet`);
  if (DRY) {
    for (const row of data.slice(0, 20)) {
      console.log(`  would set ${row.id} -> ${slugifyTitle(row.title, row.id)}`);
    }
    if (data.length > 20) console.log(`  ...and ${data.length - 20} more`);
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const row of data) {
    const slug = slugifyTitle(row.title, row.id);
    const { error: upErr } = await db.from("posts").update({ slug }).eq("id", row.id);
    if (upErr) {
      failed++;
      console.warn(`  ! ${row.id}: ${upErr.message}`);
    } else {
      ok++;
    }
  }
  console.log(`done: ${ok} slugged, ${failed} failed`);
}

await run();
