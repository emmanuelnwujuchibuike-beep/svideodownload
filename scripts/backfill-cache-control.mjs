/**
 * Add Cache-Control to R2 objects uploaded before the browser upload path set it.
 *
 * WHY: probed live 2026-07-16, a real chat video on media.frenzsave.com came back
 * with NO Cache-Control, NO Last-Modified and `Cf-Cache-Status: DYNAMIC`. With
 * nothing to compute freshness from, browsers re-fetch the object on every mount
 * — the cause of "the video sent in chat reloads each time someone enters the
 * chat" — and because the CDN wasn't caching either, every view billed R2 egress.
 *
 * `putR2` (server uploads) always set the header; the BROWSER presigned-PUT path
 * never did, and that's the path nearly all media takes. That's fixed forward in
 * lib/storage/client-upload.ts. This script repairs what's already stored.
 *
 * HOW: S3 CopyObject onto the same key with `x-amz-metadata-directive: REPLACE`,
 * which rewrites metadata without moving bytes out of R2 (no egress). Chat media
 * never expires, so unlike stories this genuinely needs a backfill.
 *
 * Usage:
 *   node scripts/backfill-cache-control.mjs --dry     # list what would change
 *   node scripts/backfill-cache-control.mjs           # apply
 */
import { readFileSync } from "node:fs";

import { AwsClient } from "aws4fetch";

const DRY = process.argv.includes("--dry");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("Missing R2 env (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).");
  process.exit(1);
}

const CACHE_CONTROL = "public, max-age=31536000, immutable";
const base = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;
const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  region: "auto",
  service: "s3",
});

const CONTENT_TYPES = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", weba: "audio/webm",
};

async function* listAll() {
  let token;
  do {
    const url = new URL(base + "/");
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (token) url.searchParams.set("continuation-token", token);
    const res = await r2.fetch(url.toString());
    if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) yield decodeXml(m[1]);
    token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
  } while (token);
}

const decodeXml = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const objUrl = (key) => `${base}/${encodeURI(key)}`;

let scanned = 0, already = 0, fixed = 0, failed = 0;

for await (const key of listAll()) {
  scanned++;
  const head = await r2.fetch(objUrl(key), { method: "HEAD" });
  if (!head.ok) {
    console.warn(`  ! HEAD ${key} -> ${head.status}`);
    failed++;
    continue;
  }
  if (head.headers.get("cache-control")) {
    already++;
    continue;
  }

  // Preserve the existing Content-Type; fall back to the extension, because
  // CopyObject+REPLACE rewrites ALL metadata — dropping Content-Type here would
  // make videos download instead of play.
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const contentType = head.headers.get("content-type") || CONTENT_TYPES[ext] || "application/octet-stream";

  if (DRY) {
    console.log(`  would fix ${key}  (${contentType}, ${head.headers.get("content-length")} bytes)`);
    fixed++;
    continue;
  }

  const res = await r2.fetch(objUrl(key), {
    method: "PUT",
    headers: {
      "x-amz-copy-source": `/${R2_BUCKET}/${encodeURI(key)}`,
      "x-amz-metadata-directive": "REPLACE",
      "Content-Type": contentType,
      "Cache-Control": CACHE_CONTROL,
    },
  });
  if (res.ok) {
    fixed++;
    if (fixed % 25 === 0) console.log(`  …${fixed} fixed`);
  } else {
    failed++;
    console.warn(`  ! copy ${key} -> ${res.status} ${await res.text()}`);
  }
}

console.log(`\nscanned ${scanned} | already cached ${already} | ${DRY ? "would fix" : "fixed"} ${fixed} | failed ${failed}`);
