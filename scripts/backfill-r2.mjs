#!/usr/bin/env node
/**
 * Backfill: move media that's still on Supabase Storage over to Cloudflare R2
 * (zero egress) and rewrite the DB URLs to the R2 CDN.
 *
 * For every media column below, any value that is a Supabase Storage public URL
 * (`.../storage/v1/object/public/<bucket>/<key>`) is downloaded, re-uploaded to
 * R2 at the SAME key (`<bucket>/<key>`, so runs are deterministic/idempotent),
 * and the column is updated to the R2 public URL. Values that already point to
 * R2, or to an external CDN (e.g. a TikTok thumbnail), are left untouched.
 *
 * Safe to re-run: already-migrated rows are skipped; a per-item failure leaves
 * that row's Supabase URL in place (nothing breaks). Nothing is deleted from
 * Supabase — you can prune the old objects yourself once you're satisfied.
 *
 * Usage (env must be set, or present in .env.local):
 *   node scripts/backfill-r2.mjs                 # migrate everything pending
 *   node scripts/backfill-r2.mjs --limit 200     # cap total objects moved
 *   node scripts/backfill-r2.mjs --dry-run       # report only, change nothing
 *   node scripts/backfill-r2.mjs --table posts   # one table only
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *               R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *               R2_BUCKET, R2_PUBLIC_BASE_URL
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

// Tables + the media columns on each that may hold a Supabase Storage URL.
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

const stats = { moved: 0, skipped: 0, failed: 0, bytes: 0 };
let budget = LIMIT;

async function processTable({ table, cols }) {
  const PAGE = 200;
  let from = 0;
  for (;;) {
    if (budget <= 0) return;
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
      return; // table/column not present — move on
    }
    if (rows.length === 0) return;
    from += rows.length;

    for (const row of rows) {
      if (budget <= 0) return;
      const update = {};
      for (const col of cols) {
        const key = keyFromSupabaseUrl(row[col]);
        if (!key) {
          continue;
        }
        if (DRY_RUN) {
          console.log(`  would move ${table}.${col} ${row.id} → ${key}`);
          update[col] = r2PublicUrl(key); // mark as "would change" for the count
          budget--;
          stats.moved++;
          if (budget <= 0) break;
          continue;
        }
        try {
          const { url, bytes } = await migrateObject(row[col], key);
          update[col] = url;
          stats.bytes += bytes;
          budget--;
          await new Promise((r) => setTimeout(r, 120)); // gentle pace
          if (budget <= 0) break;
        } catch (e) {
          stats.failed++;
          console.warn(`  ✗ ${table}.${col} ${row.id}: ${e.message}`);
        }
      }
      if (Object.keys(update).length > 0) {
        if (DRY_RUN) {
          // counts already tallied above
        } else {
          const { error: upErr } = await db.from(table).update(update).eq("id", row.id);
          if (upErr) {
            stats.failed += Object.keys(update).length;
            console.warn(`  ✗ update ${table} ${row.id}: ${upErr.message}`);
          } else {
            stats.moved += Object.keys(update).length;
            console.log(`  ✓ ${table} ${row.id} (${Object.keys(update).join(", ")})`);
          }
        }
      } else {
        stats.skipped++;
      }
    }
  }
}

async function main() {
  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Backfilling Supabase Storage → R2 (${R2_PUBLIC_BASE_URL})` +
      (Number.isFinite(LIMIT) ? `, up to ${LIMIT} object(s)` : "") +
      (ONLY_TABLE ? `, table=${ONLY_TABLE}` : "") +
      "\n",
  );
  for (const target of TARGETS) {
    if (ONLY_TABLE && target.table !== ONLY_TABLE) continue;
    if (budget <= 0) break;
    console.log(`→ ${target.table} (${target.cols.join(", ")})`);
    await processTable(target);
  }
  const mb = (stats.bytes / (1024 * 1024)).toFixed(1);
  console.log(
    `\nDone. ${stats.moved} moved, ${stats.failed} failed, ${stats.skipped} rows already clean.` +
      (DRY_RUN ? " (dry-run — nothing changed)" : ` ~${mb} MB transferred.`),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
