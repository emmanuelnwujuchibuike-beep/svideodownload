#!/usr/bin/env node
/**
 * Backfill real video posters. For every video post with no thumbnail_url, this
 * downloads the video from R2, extracts a frame with ffmpeg (~1s in), uploads
 * the JPG next to the video in R2, and sets posts.thumbnail_url. Idempotent:
 * posts that already have a thumbnail are skipped.
 *
 * Requires ffmpeg on PATH (or FFMPEG_PATH set).
 *
 * Usage:  node scripts/backfill-thumbnails.mjs [--limit N] [--dry-run]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID,
 *      R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* rely on real env */
}

const { NEXT_PUBLIC_SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SB_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const R2_BASE = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
if (!SB_URL || !SB_KEY || !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_BASE) {
  console.error("Missing env (Supabase + R2).");
  process.exit(1);
}

const argv = process.argv.slice(2);
const LIMIT = argv.indexOf("--limit") > -1 ? Number(argv[argv.indexOf("--limit") + 1]) : Infinity;
const DRY_RUN = argv.includes("--dry-run");

const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, region: "auto", service: "s3" });

const r2Key = (url) => (url.startsWith(R2_BASE + "/") ? decodeURIComponent(url.slice(R2_BASE.length + 1).split("?")[0]) : null);
const r2Endpoint = (key) => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${encodeURI(key)}`;
const r2PublicUrl = (key) => `${R2_BASE}/${key.split("/").map(encodeURIComponent).join("/")}`;

function ffmpegFrame(inPath, outPath, seek) {
  return new Promise((resolve) => {
    // -ss before -i = fast seek; grab one frame, scale to 720w, decent quality.
    const args = ["-ss", String(seek), "-i", inPath, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", "-y", outPath];
    const p = spawn(FFMPEG, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => resolve({ ok: false, err: "ffmpeg not found" }));
    p.on("close", (code) => resolve({ ok: code === 0, err }));
  });
}

async function main() {
  const { data, error } = await db
    .from("posts")
    .select("id, media_url, thumbnail_url")
    .eq("media_kind", "video")
    .not("media_url", "is", null)
    .is("thumbnail_url", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  let posts = (data ?? []).filter((p) => r2Key(p.media_url));
  if (Number.isFinite(LIMIT)) posts = posts.slice(0, LIMIT);
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Found ${posts.length} video(s) needing a poster.\n`);

  const dir = mkdtempSync(join(tmpdir(), "frenz-thumbs-"));
  let ok = 0, failed = 0;
  for (const post of posts) {
    const key = r2Key(post.media_url);
    const thumbKey = key.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    const vid = join(dir, "v.mp4");
    const jpg = join(dir, "f.jpg");
    try {
      if (DRY_RUN) {
        console.log(`  would poster ${post.id} → ${thumbKey}`);
        ok++;
        continue;
      }
      // Download the video from R2.
      const res = await fetch(post.media_url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      writeFileSync(vid, Buffer.from(await res.arrayBuffer()));
      // Extract a frame (retry at 0s if 1s is past the end).
      let r = await ffmpegFrame(vid, jpg, 1);
      let bytes;
      try { bytes = readFileSync(jpg); } catch { bytes = null; }
      if (!r.ok || !bytes || bytes.length === 0) {
        r = await ffmpegFrame(vid, jpg, 0);
        bytes = readFileSync(jpg);
      }
      if (!bytes || bytes.length === 0) throw new Error("no frame extracted");
      // Upload the poster to R2.
      const put = await r2.fetch(r2Endpoint(thumbKey), {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
      });
      if (!put.ok) throw new Error(`R2 ${put.status}`);
      const url = r2PublicUrl(thumbKey);
      const { error: upErr } = await db.from("posts").update({ thumbnail_url: url }).eq("id", post.id);
      if (upErr) throw upErr;
      ok++;
      console.log(`  ✓ ${post.id} (${(bytes.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      console.warn(`  ✗ ${post.id}: ${e.message}`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}Done. ${ok} ${DRY_RUN ? "would be postered" : "postered"}, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
