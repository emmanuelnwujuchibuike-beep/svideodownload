/**
 * Generate first-frame posters for videos that don't have one.
 *
 * WHY: a video preview with no poster has to render
 *   <video src="…mp4#t=0.1" preload="metadata">
 * which re-requests the MP4 on EVERY mount — the service worker deliberately
 * skips video (routes.js: native range-request pipeline), and Safari re-fetches
 * ranges regardless of Cache-Control. So no cache header can fix this; only an
 * <img> poster can. That's the owner's "the video sent in chat reloads each time
 * someone enters the chat" / "is the video in particular that reloads".
 *
 * New uploads already capture a poster client-side (captureVideoPoster, wired
 * into the chat composer and story studio). This repairs everything uploaded
 * BEFORE that, which otherwise never gets one:
 *   - message_attachments (media_kind='video', thumbnail_url is null) — permanent
 *   - stories (media_kind='video', thumbnail_url is null) — 24h, but they're
 *     what's on screen right now
 *
 * Frame at 0.3s, not 0: the frame at exactly 0 is black/absent in some encoders.
 *
 * Usage:
 *   node scripts/backfill-video-posters.mjs --dry
 *   node scripts/backfill-video-posters.mjs
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const DRY = process.argv.includes("--dry");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL } = process.env;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  region: "auto",
  service: "s3",
});
const base = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;
const publicBase = R2_PUBLIC_BASE_URL.replace(/\/$/, "");

/** `https://media.../{owner}/videos/123-abc.mp4` -> `{owner}/images/123-abc-poster.jpg` */
function posterKeyFor(videoUrl) {
  const path = new URL(videoUrl).pathname.replace(/^\//, "");
  const parts = path.split("/");
  const file = parts.pop().replace(/\.[^.]+$/, "");
  const owner = parts[0] ?? "posters";
  return `${owner}/images/${file}-poster.jpg`;
}

async function posterFor(videoUrl) {
  const dir = mkdtempSync(join(tmpdir(), "poster-"));
  const out = join(dir, "poster.jpg");
  try {
    // ffmpeg reads the URL directly — no need to download the whole file first;
    // it fetches only the ranges it needs to decode one frame.
    await execFileAsync("ffmpeg", [
      "-loglevel", "error",
      "-ss", "0.3",
      "-i", videoUrl,
      "-frames:v", "1",
      "-vf", "scale='min(1080,iw)':-2",
      "-q:v", "4",
      "-y", out,
    ]);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function uploadPoster(key, bytes) {
  const res = await r2.fetch(`${base}/${encodeURI(key)}`, {
    method: "PUT",
    body: bytes,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
  return `${publicBase}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function run(table, label) {
  const { data, error } = await db
    .from(table)
    .select("id, media_url, thumbnail_url")
    .eq("media_kind", "video")
    .is("thumbnail_url", null);
  if (error) {
    console.log(`${label}: query failed (${error.code}) — skipping`);
    return;
  }
  console.log(`\n${label}: ${data.length} video(s) without a poster`);
  for (const row of data) {
    const key = posterKeyFor(row.media_url);
    if (DRY) {
      console.log(`  would generate ${key}`);
      continue;
    }
    try {
      const bytes = await posterFor(row.media_url);
      const url = await uploadPoster(key, bytes);
      const { error: upErr } = await db.from(table).update({ thumbnail_url: url }).eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      console.log(`  ✓ ${row.id} -> ${(bytes.length / 1024).toFixed(0)}KB poster`);
    } catch (e) {
      console.warn(`  ! ${row.id}: ${e.message}`);
    }
  }
}

await run("message_attachments", "chat videos");
await run("stories", "stories");
console.log("\ndone");
