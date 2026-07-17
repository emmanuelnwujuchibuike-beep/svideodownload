import { AwsClient } from "aws4fetch";

import { MEDIA_CACHE_CONTROL } from "./cache-control";

/**
 * Cloudflare R2 storage backend (S3-compatible) — the main store for large media
 * (videos, audio, reels, story media). Zero egress fees, served through the
 * Cloudflare CDN via a public bucket domain. Small profile images stay on
 * Supabase (see lib/storage/index.ts).
 *
 * SERVER ONLY: the R2 secret must never reach the browser. This module is
 * imported only by server code (the worker + API routes); clients upload via a
 * short-lived presigned URL (see /api/uploads/presign) and never see credentials.
 *
 * Required env (all must be set to enable R2; otherwise the app falls back to
 * Supabase Storage so nothing breaks before R2 is provisioned):
 *   R2_ACCOUNT_ID          Cloudflare account id
 *   R2_ACCESS_KEY_ID       R2 API token access key
 *   R2_SECRET_ACCESS_KEY   R2 API token secret
 *   R2_BUCKET              bucket name
 *   R2_PUBLIC_BASE_URL     public base, e.g. https://media.frenz.app or https://pub-xxx.r2.dev
 */

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;
const PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");

export const hasR2 =
  !!ACCOUNT_ID && !!ACCESS_KEY_ID && !!SECRET_ACCESS_KEY && !!BUCKET && !!PUBLIC_BASE_URL;

let client: AwsClient | null = null;
function r2(): AwsClient {
  if (!client) {
    client = new AwsClient({
      accessKeyId: ACCESS_KEY_ID!,
      secretAccessKey: SECRET_ACCESS_KEY!,
      region: "auto",
      service: "s3",
    });
  }
  return client;
}

/** The S3 endpoint for an object key in our bucket. */
function objectEndpoint(key: string): string {
  return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${encodeURI(key)}`;
}

/** Public, CDN-served URL for a stored object. */
export function r2PublicUrl(key: string): string {
  return `${PUBLIC_BASE_URL}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Upload bytes to R2 from server code. Returns the public URL. */
export async function putR2(key: string, body: Uint8Array | ArrayBuffer | Blob, contentType: string): Promise<string> {
  const res = await r2().fetch(objectEndpoint(key), {
    method: "PUT",
    body: body as BodyInit,
    headers: { "Content-Type": contentType, "Cache-Control": MEDIA_CACHE_CONTROL },
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed: ${res.status}`);
  }
  return r2PublicUrl(key);
}

/**
 * A short-lived presigned PUT URL so a browser/native client can upload straight
 * to R2 (no bytes through our server). Content-Type is sent by the client at
 * upload time. Returns the upload URL plus the eventual public URL.
 */
export async function presignR2Put(
  key: string,
  expiresSeconds = 300,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  // aws4fetch reads the expiry from the X-Amz-Expires query param when signQuery.
  const url = new URL(objectEndpoint(key));
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await r2().sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
  return { uploadUrl: signed.url, publicUrl: r2PublicUrl(key) };
}
