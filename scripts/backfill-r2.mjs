#!/usr/bin/env node
/**
 * Media storage utility: move existing media to Cloudflare R2, re-point URLs to a
 * new R2 host, or prune the migrated originals off Supabase. Three modes:
 *
 *   MIGRATE (default) — for every media column below, any value that's a Supabase
 *     Storage public URL is downloaded, re-uploaded to R2 at the SAME key
 *     (`<bucket>/<key>`, deterministic), and the column is rewritten to the R2
 *     public URL. Already-R2 or external URLs are left alone. Idempotent.
 *
 *   REHOST (--rehost <oldBase> <newBase>) — pure DB rewrite: swap the host on
 *     URLs that start with <oldBase> to <newBase> (same object key). No downloads
 *     — use this to move from the r2.dev URL to a custom domain later.
 *
 *   PRUNE (--prune) — delete the original objects from Supabase Storage for media
 *     that's now on R2. Each object is only removed after confirming its R2 copy
 *     serves (HEAD 200). Nothing referenced by a non-R2 URL is touched.
 *
 * The media columns scanned: posts(media_url, thumbnail_url),
 * profiles(avatar_url, banner_url), stories(media_url), post_comments(image_url).
 *
 * Usage (env in .env.local or the real environment):
 *   node scripts/backfill-r2.mjs                          # migrate everything pending
 *   node scripts/backfill-r2.mjs --dry-run                # report only, change nothing
 *   node scripts/backfill-r2.mjs --limit 200              # cap objects processed
 *   node scripts/backfill-r2.mjs --table posts           # one table only
 *   node scripts/backfill-r2.mjs --rehost https://pub-x.r2.dev https://media.frenzsave.com
 *   node scripts/backfill-r2.mjs --prune --dry-run        # list what prune would delete
 *   node scripts/backfill-r2.mjs --prune                  # delete migrated originals
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID,
 *               R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
 */
import { readFileSync } from "node:fs";

import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";

// Best-effort .env.local loader so the script "just works" locally.
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env.local — rely on the real environment */
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");

if (
  !SUPABASE_URL ||
  !SERVICE_KEY ||
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET ||
  !R2_PUBLIC_BASE_URL
) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.",
  );
  process.exit(1);
}

// ── CLI flags ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(name);
const LIMIT = flag("--limit") > -1 ? Number(argv[flag("--limit") + 1]) : Infinity;
const DRY_RUN = flag("--dry-run") > -1;
const ONLY_TABLE = flag("--table") > -1 ? argv[flag("--table") + 1] : null;
const PRUNE = flag("--prune") > -1;
const REHOST = flag("--rehost") > -1 ? { old: argv[flag("--rehost") + 1], neu: argv[flag("--rehost") + 2] } : null;

// Tables + the media columns on each that may hold a media URL.
const TARGETS = [
  { table: "posts", cols: ["media_url", "thumbnail_url"] },
  { table: "profiles", cols: ["avatar_url", "banner_url"] },
  { table: "stories", cols: ["media_url"] },
  { table: "post_comments", cols: ["image_url"] },
];

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, region: "auto", service: "s3" });

const SUPABASE_MARKER = "/storage/v1/object/public/";
const EXT_CT = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Extract the storage object key (`<bucket>/<path>`, decoded) from a Supabase
 *  public URL, or null if the URL isn't one of ours / is already on R2. */
function keyFromSupabaseUrl(url) {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith(R2_PUBLIC_BASE_URL)) return null; // already migrated
  const idx = url.indexOf(SUPABASE_MARKER);
  if (idx === -1) return null; // external URL (e.g. platform CDN) — leave alone
  const rest = url.slice(idx + SUPABASE_MARKER.length).split("?")[0];
  if (!rest) return null;
  try {
    return rest.split("/").map(decodeURIComponent).join("/");
  } catch {
    return rest;
  }
}

function r2Endpoint(key) {
  return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${encodeURI(key)}`;
}
function r2PublicUrl(key) {
  return `${R2_PUBLIC_BASE_URL}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
function guessCt(key, headerCt) {
  if (headerCt && headerCt !== "application/octet-stream") return headerCt;
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CT[ext] ?? "application/octet-stream";
}

/** Download from Supabase → upload to R2 at the same key. Returns the R2 URL. */
async function migrateObject(sourceUrl, key) {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  const ct = guessCt(key, res.headers.get("content-type"));
  const put = await r2.fetch(r2Endpoint(key), {
    method: "PUT",
    body,
    headers: { "Content-Type": ct, "Cache-Control": "public, max-age=31536000, immutable" },
  });
  if (!put.ok) throw new Error(`R2 ${put.status}: ${await put.text().catch(() => "")}`);
  return { url: r2PublicUrl(key), bytes: body.length };
}

/** Async-iterate every row of a table (id + the given cols), paged. */
async function* eachRow(table, cols) {
  const PAGE = 200;
  let from = 0;
  for (;;) {
    let rows;
    try {
      const { data, error } = await db
        .from(table)
        .select(["id", ...cols].join(", "))
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows = data ?? [];
    } catch (e) {
      console.warn(`• skipping ${table} (${e.message})`);
      return;
    }
    if (rows.length === 0) return;
    from += rows.length;
    for (const row of rows) yield row;
  }
}

const targets = () => TARGETS.filter((t) => !ONLY_TABLE || t.table === ONLY_TABLE);
let budget = LIMIT;

// ── MIGRATE ──────────────────────────────────────────────────────────────────
async function migrateAll() {
  const stats = { moved: 0, failed: 0, skipped: 0, bytes: 0 };
  for (const t of targets()) {
    if (budget <= 0) break;
    console.log(`→ ${t.table} (${t.cols.join(", ")})`);
    for await (const row of eachRow(t.table, t.cols)) {
      if (budget <= 0) break;
      const update = {};
      for (const col of t.cols) {
        const key = keyFromSupabaseUrl(row[col]);
        if (!key) continue;
        if (DRY_RUN) {
          console.log(`  would move ${t.table}.${col} ${row.id} → ${key}`);
          update[col] = r2PublicUrl(key);
          stats.moved++;
          budget--;
          if (budget <= 0) break;
          continue;
        }
        try {
          const { url, bytes } = await migrateObject(row[col], key);
          update[col] = url;
          stats.bytes += bytes;
          budget--;
          await sleep(120);
          if (budget <= 0) break;
        } catch (e) {
          stats.failed++;
          console.warn(`  ✗ ${t.table}.${col} ${row.id}: ${e.message}`);
        }
      }
      if (!DRY_RUN && Object.keys(update).length > 0) {
        const { error } = await db.from(t.table).update(update).eq("id", row.id);
        if (error) {
          stats.failed += Object.keys(update).length;
          console.warn(`  ✗ update ${t.table} ${row.id}: ${error.message}`);
        } else {
          stats.moved += Object.keys(update).length;
          console.log(`  ✓ ${t.table} ${row.id} (${Object.keys(update).join(", ")})`);
        }
      } else if (Object.keys(update).length === 0) {
        stats.skipped++;
      }
    }
  }
  const mb = (stats.bytes / (1024 * 1024)).toFixed(1);
  console.log(
    `\nDone. ${stats.moved} moved, ${stats.failed} failed, ${stats.skipped} rows already clean.` +
      (DRY_RUN ? " (dry-run — nothing changed)" : ` ~${mb} MB transferred.`),
  );
}

// ── REHOST ───────────────────────────────────────────────────────────────────
async function rehostAll(oldBase, newBase) {
  oldBase = oldBase.replace(/\/$/, "");
  newBase = newBase.replace(/\/$/, "");
  let changed = 0;
  for (const t of targets()) {
    if (budget <= 0) break;
    for await (const row of eachRow(t.table, t.cols)) {
      if (budget <= 0) break;
      const update = {};
      for (const col of t.cols) {
        const v = row[col];
        if (typeof v === "string" && v.startsWith(oldBase + "/")) update[col] = newBase + v.slice(oldBase.length);
      }
      const n = Object.keys(update).length;
      if (n === 0) continue;
      if (DRY_RUN) {
        console.log(`  would rehost ${t.table} ${row.id} (${Object.keys(update).join(", ")})`);
      } else {
        const { error } = await db.from(t.table).update(update).eq("id", row.id);
        if (error) {
          console.warn(`  ✗ ${t.table} ${row.id}: ${error.message}`);
          continue;
        }
        console.log(`  ✓ ${t.table} ${row.id}`);
      }
      changed += n;
      budget -= n;
    }
  }
  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}Rehost done. ${changed} URL(s) ${DRY_RUN ? "would change" : "updated"}.`);
}

// ── PRUNE ────────────────────────────────────────────────────────────────────
async function pruneAll() {
  // Collect the Supabase (bucket → key → sample R2 url) for everything now on R2.
  const byBucket = new Map();
  for (const t of targets()) {
    for await (const row of eachRow(t.table, t.cols)) {
      for (const col of t.cols) {
        const v = row[col];
        if (typeof v !== "string" || !v.startsWith(R2_PUBLIC_BASE_URL + "/")) continue;
        const path = v.slice(R2_PUBLIC_BASE_URL.length + 1).split("?")[0];
        const decoded = path.split("/").map(decodeURIComponent).join("/");
        const i = decoded.indexOf("/");
        if (i < 1) continue;
        const bucket = decoded.slice(0, i);
        const key = decoded.slice(i + 1);
        if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
        byBucket.get(bucket).set(key, v);
      }
    }
  }
  let total = 0;
  for (const keys of byBucket.values()) total += keys.size;
  console.log(`Found ${total} migrated object(s) across ${byBucket.size} Supabase bucket(s).`);

  let deleted = 0;
  let kept = 0;
  let failed = 0;
  for (const [bucket, keys] of byBucket) {
    for (const [key, url] of keys) {
      if (budget <= 0) break;
      // Only delete the Supabase original once the R2 copy is confirmed serving.
      let onR2 = false;
      try {
        const h = await fetch(url, { method: "HEAD" });
        onR2 = h.ok;
      } catch {
        onR2 = false;
      }
      if (!onR2) {
        kept++;
        console.warn(`  ! keep ${bucket}/${key} — R2 copy not confirmed`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  would delete ${bucket}/${key}`);
        deleted++;
        budget--;
        continue;
      }
      const { error } = await db.storage.from(bucket).remove([key]);
      if (error) {
        failed++;
        console.warn(`  ✗ ${bucket}/${key}: ${error.message}`);
      } else {
        deleted++;
        budget--;
      }
    }
  }
  console.log(
    `\n${DRY_RUN ? "[dry-run] " : ""}Prune done. ${deleted} ${DRY_RUN ? "would be deleted" : "deleted"}, ${kept} kept (not confirmed on R2)` +
      (failed ? `, ${failed} failed` : "") +
      ".",
  );
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cap = Number.isFinite(LIMIT) ? `, up to ${LIMIT} object(s)` : "";
  const only = ONLY_TABLE ? `, table=${ONLY_TABLE}` : "";
  if (REHOST) {
    if (!REHOST.old || !REHOST.neu || REHOST.neu.startsWith("--")) {
      console.error("Usage: --rehost <oldBaseUrl> <newBaseUrl>");
      process.exit(1);
    }
    console.log(`${DRY_RUN ? "[dry-run] " : ""}Rehost ${REHOST.old} → ${REHOST.neu}${cap}${only}\n`);
    await rehostAll(REHOST.old, REHOST.neu);
  } else if (PRUNE) {
    console.log(`${DRY_RUN ? "[dry-run] " : ""}Prune migrated originals from Supabase Storage${cap}${only}\n`);
    await pruneAll();
  } else {
    console.log(
      `${DRY_RUN ? "[dry-run] " : ""}Backfilling Supabase Storage → R2 (${R2_PUBLIC_BASE_URL})${cap}${only}\n`,
    );
    await migrateAll();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
