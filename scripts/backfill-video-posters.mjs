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
 *   - posts (2026-07-17) — see below. This is what the FEED and the LANDING PAGE
 *     render, and it was the one table this script never covered.
 *
 * POSTS ARE A SECOND, WORSE PROBLEM: a foreign poster URL that EXPIRES.
 * A post created from a download stored whatever thumbnail yt-dlp resolved —
 * usually the source platform's *signed* CDN URL (p16-/p19-common-sign.tiktokcdn-us.com,
 * scontent-*.fbcdn.net). Those signatures lapse and the URL then 403s FOREVER, so
 * the tile is permanently broken. Measured 2026-07-17: 50 of 64 video posts had a
 * dead or missing poster (21 p16, 13 p19, 15 null, 1 fbcdn); only 14 were healthy.
 *
 * So for `posts` the rule is not "thumbnail_url is null" but "the poster is not on
 * OUR media host" — a foreign host is, by definition, a URL we don't control and
 * can't keep alive. Re-hosting to R2 fixes it permanently and costs no egress.
 * Videos themselves are already all on R2, which is why a poster can be regenerated
 * at all: ffmpeg reads OUR mp4, not the platform's expired link.
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

/**
 * @param reclaimForeign  also re-host posters that live on someone else's CDN.
 *   Only `posts` needs this (see the header): chat/stories posters were always
 *   captured client-side and written straight to R2, so for those a non-null
 *   thumbnail is already ours and must not be touched.
 */
async function run(table, label, { reclaimForeign = false } = {}) {
  // Filter in JS rather than PostgREST: the predicate is "not on our host",
  // which means a `not.like` against a URL full of `:`/`/`/`.` — easy to get
  // subtly wrong and silently match nothing. These tables are small.
  const { data, error } = await db
    .from(table)
    .select("id, media_url, thumbnail_url")
    .eq("media_kind", "video");
  if (error) {
    console.log(`${label}: query failed (${error.code}) — skipping`);
    return;
  }

  const skipped = [];
  const targets = data.filter((row) => {
    // ffmpeg has to be able to READ the source. If the video itself is on a
    // foreign (likely expired) URL there is nothing to grab a frame from.
    if (!row.media_url?.startsWith(publicBase)) {
      if (!row.thumbnail_url) skipped.push(row.id);
      return false;
    }
    if (!row.thumbnail_url) return true;
    return reclaimForeign && !row.thumbnail_url.startsWith(publicBase);
  });

  const missing = targets.filter((r) => !r.thumbnail_url).length;
  const foreign = targets.length - missing;
  console.log(
    `\n${label}: ${data.length} video(s), ${targets.length} need a poster` +
      (targets.length ? ` (${missing} missing, ${foreign} on a foreign/expiring CDN)` : ""),
  );
  if (skipped.length) console.log(`  (${skipped.length} skipped — source video is not on our media host)`);

  let ok = 0;
  let failed = 0;
  for (const row of targets) {
    const key = posterKeyFor(row.media_url);
    if (DRY) {
      const why = row.thumbnail_url ? `replace ${new URL(row.thumbnail_url).host}` : "no poster";
      console.log(`  would generate ${key}  (${why})`);
      continue;
    }
    try {
      const bytes = await posterFor(row.media_url);
      const url = await uploadPoster(key, bytes);
      const { error: upErr } = await db.from(table).update({ thumbnail_url: url }).eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      ok++;
      console.log(`  ✓ ${row.id} -> ${(bytes.length / 1024).toFixed(0)}KB poster`);
    } catch (e) {
      failed++;
      console.warn(`  ! ${row.id}: ${e.message}`);
    }
  }
  if (!DRY && targets.length) console.log(`  ${label}: ${ok} repaired, ${failed} failed`);
}

await run("message_attachments", "chat videos");
await run("stories", "stories");
// `posts` is the public surface (feed + landing page) and the only table whose
// posters were hotlinked to an expiring foreign CDN — so it alone reclaims them.
await run("posts", "feed posts", { reclaimForeign: true });
console.log("\ndone");
