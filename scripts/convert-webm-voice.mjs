#!/usr/bin/env node
/**
 * Chat voice notes recorded as WebM → M4A (owner, 2026-10-29: old voice notes "don't make sound after some months";
 * an iPhone showed "This voice note can't play on this device").
 *
 * Every voice note before 2026-10-09 was recorded as WebM/Opus, which Safari on iPhone often cannot play; since then the
 * recorder prefers MP4/AAC (lib/media/comment-recording.ts). The files were never lost — they were in a format the
 * phone refuses. For each chat audio attachment still in WebM this downloads it, converts it with the local ffmpeg to
 * AAC in an .m4a beside it (same key, .m4a), uploads that to R2, and points the attachment at it. The WebM original is
 * KEPT, so the change is reversible (point media_url back). Idempotent: a converted note no longer ends in .webm.
 *
 * Usage: node scripts/convert-webm-voice.mjs [--dry-run]
 * Needs ffmpeg on PATH, and NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL (.env.local is read).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { AwsClient } from "aws4fetch";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* rely on the real environment */
}
const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const BASE = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !BASE) {
  console.error("Missing env (Supabase service role + R2).");
  process.exit(1);
}
const DRY = process.argv.includes("--dry-run");
const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, region: "auto", service: "s3" });
const endpoint = (key) => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;

const { data, error } = await db.from("message_attachments").select("id, media_url").eq("media_kind", "audio").like("media_url", "%.webm");
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`${data.length} WebM voice note(s)${DRY ? " (dry run — nothing changes)" : ""}`);
let done = 0;
let failed = 0;
for (const row of data) {
  if (!row.media_url.startsWith(BASE + "/")) {
    console.warn(`  skip ${row.id}: not on ${BASE}`);
    continue;
  }
  const key = decodeURIComponent(row.media_url.slice(BASE.length + 1).split("?")[0]).replace(/\.webm$/, ".m4a");
  const url = `${BASE}/${key.split("/").map(encodeURIComponent).join("/")}`;
  if (DRY) {
    console.log(`  would convert ${row.id} → ${url}`);
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), "voice-"));
  try {
    const res = await fetch(row.media_url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    writeFileSync(join(dir, "in.webm"), new Uint8Array(await res.arrayBuffer()));
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", join(dir, "in.webm"), "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", join(dir, "out.m4a")]);
    const body = readFileSync(join(dir, "out.m4a"));
    const put = await r2.fetch(endpoint(key), { method: "PUT", body, headers: { "Content-Type": "audio/mp4", "Cache-Control": "public, max-age=31536000, immutable" } });
    if (!put.ok) throw new Error(`R2 ${put.status}`);
    const check = await fetch(url, { method: "HEAD" });
    if (!check.ok) throw new Error(`new file not served (${check.status})`);
    const { error: upErr } = await db.from("message_attachments").update({ media_url: url, mime_type: "audio/mp4" }).eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
    done++;
    console.log(`  ✓ ${row.id} (${body.length} bytes)`);
  } catch (e) {
    failed++;
    console.warn(`  ✗ ${row.id}: ${e instanceof Error ? e.message : e}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
if (!DRY) console.log(`Done. ${done} converted, ${failed} failed. The WebM originals are kept.`);
