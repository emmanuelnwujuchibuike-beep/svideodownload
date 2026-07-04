#!/usr/bin/env node
/**
 * One-time: set the CORS policy on the R2 bucket so the browser can upload media
 * directly (presigned PUT) and read it back. Without this, uploads fail the CORS
 * preflight ("load failed" when posting). Idempotent — safe to re-run.
 *
 * Usage: node scripts/setup-r2-cors.mjs
 * Env:   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { AwsClient } from "aws4fetch";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* rely on real env */
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("Missing R2 env.");
  process.exit(1);
}

// Presigned uploads carry no cookies, so a wildcard origin is safe here (the
// presigned URL itself is the auth). Covers apex, www, vercel + localhost too.
const CORS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, region: "auto", service: "s3" });
const md5 = createHash("md5").update(CORS_XML).digest("base64");
const url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}?cors`;

const res = await r2.fetch(url, {
  method: "PUT",
  body: CORS_XML,
  headers: { "Content-Type": "application/xml", "Content-MD5": md5 },
});
console.log("PutBucketCors:", res.status, res.ok ? "✓ CORS policy applied" : "✗ FAILED");
if (!res.ok) {
  console.log(await res.text());
  process.exit(1);
}

// Verify with a preflight.
const pre = await fetch(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/_probe.mp4`, {
  method: "OPTIONS",
  headers: { Origin: "https://www.frenzsave.com", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
});
console.log("preflight:", pre.status, "| allow-origin:", pre.headers.get("access-control-allow-origin"), "| allow-methods:", pre.headers.get("access-control-allow-methods"));
process.exit(0);
