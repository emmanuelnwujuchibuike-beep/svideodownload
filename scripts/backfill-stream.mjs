#!/usr/bin/env node
/**
 * Backfill Cloudflare Stream for existing video posts.
 *
 * Finds published video posts that have a stored `media_url` but no `stream_uid`,
 * pulls each one into Cloudflare Stream by URL (the "copy" API), and records the
 * returned uid on the post so playback switches to adaptive-bitrate HLS. Safe to
 * re-run — already-copied posts are skipped, and any failure leaves the post's
 * `media_url` untouched (playback keeps working).
 *
 * Usage (env must be set, or present in .env.local):
 *   node scripts/backfill-stream.mjs            # process all pending
 *   node scripts/backfill-stream.mjs --limit 50 # process at most 50
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *               CF_STREAM_ACCOUNT_ID, CF_STREAM_API_TOKEN
 */
import { readFileSync } from "node:fs";

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
const ACCOUNT_ID = process.env.CF_STREAM_ACCOUNT_ID;
const API_TOKEN = process.env.CF_STREAM_API_TOKEN;

if (!SUPABASE_URL || !SERVICE_KEY || !ACCOUNT_ID || !API_TOKEN) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CF_STREAM_ACCOUNT_ID, CF_STREAM_API_TOKEN.",
  );
  process.exit(1);
}

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function copyToStream(url, creator) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/copy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...(creator ? { creator } : {}) }),
  });
  if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.result?.uid ?? null;
}

async function main() {
  const { data, error } = await db
    .from("posts")
    .select("id, publisher_id, media_url")
    .eq("media_kind", "video")
    .not("media_url", "is", null)
    .is("stream_uid", null)
    .order("created_at", { ascending: false })
    .limit(Number.isFinite(LIMIT) ? LIMIT : 1000);
  if (error) throw error;

  const posts = data ?? [];
  console.log(`Found ${posts.length} video post(s) to backfill.`);
  let ok = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      const uid = await copyToStream(post.media_url, post.publisher_id);
      if (!uid) throw new Error("no uid returned");
      const { error: upErr } = await db.from("posts").update({ stream_uid: uid }).eq("id", post.id);
      if (upErr) throw upErr;
      ok++;
      console.log(`✓ ${post.id} → ${uid}`);
    } catch (e) {
      failed++;
      console.warn(`✗ ${post.id}: ${e.message}`);
    }
    // Gentle pace so we don't hammer the Stream API.
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\nDone. ${ok} copied, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
