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

/** The object key behind one of our public URLs — null for anything else (another host, a bad escape). */
export function r2KeyOfPublicUrl(url: unknown): string | null {
  const base = r2PublicUrl("");
  if (typeof url !== "string" || !url.startsWith(base) || url.length === base.length) return null;
  try {
    return url.slice(base.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/** Attempts per upload — a 5xx or 429 from R2 is tried again, as aws4fetch's own fetch did. */
const PUT_ATTEMPTS = 3;

/**
 * Upload bytes to R2 from server code. Returns the public URL.
 *
 * 🔴 THE BYTES GO AS BYTES, SO THE LENGTH IS ALWAYS STATED (2026-10-30). aws4fetch's own `fetch` wraps the body in a
 * `Request` and hands THAT to fetch. On the worker (Node 22) a ~68 KB blurred clip then went out with no Content-Length
 * and R2 refused it — "R2 upload failed: 411" (Length Required) on 8 of 11 clips, measured on production — while the
 * same code passed on Node 24 here. aws4fetch now only SIGNS; the request is sent with a plain byte array, whose length
 * fetch always declares. Every server upload goes through here (the blurred clips, the sound mix, lib/storage).
 */
export async function putR2(key: string, body: Uint8Array | ArrayBuffer | Blob, contentType: string): Promise<string> {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body instanceof Blob ? await body.arrayBuffer() : body);
  const headers = { "Content-Type": contentType, "Cache-Control": MEDIA_CACHE_CONTROL };
  let res: Response | null = null;
  for (let attempt = 1; attempt <= PUT_ATTEMPTS; attempt++) {
    // signed again each attempt: the signature carries the time
    const signed = await r2().sign(objectEndpoint(key), { method: "PUT", body: bytes as BodyInit, headers });
    res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes as BodyInit });
    if (res.status < 500 && res.status !== 429) break;
  }
  if (!res?.ok) {
    throw new Error(`R2 upload failed: ${res?.status ?? "no answer"}`);
  }
  return r2PublicUrl(key);
}

/**
 * Remove one object from the PUBLIC bucket (the Stories expiry sweep). True when
 * the object is gone afterwards — R2 answers 204 for a key that was never there,
 * so a retry of an already-deleted file is a success, not an error.
 */
export async function deleteR2(key: string): Promise<boolean> {
  if (!hasR2) return false;
  const res = await r2().fetch(objectEndpoint(key), { method: "DELETE" }).catch(() => null);
  return !!res && (res.status === 204 || res.status === 200 || res.status === 404);
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

/*
 * ── The PRIVATE bucket (0227, subscriber-only posts) ───────────────────────────
 * A second bucket with NO public domain: nothing in it can be fetched by URL.
 * An object leaves only through a presigned GET minted by the server AFTER it has
 * checked that the viewer is an active subscriber, and that link expires within
 * minutes. It must be a different bucket from R2_BUCKET (whose objects are public
 * through R2_PUBLIC_BASE_URL) — `hasPrivateR2` is false otherwise, and subscriber
 * uploads are refused rather than stored publicly.
 *
 *   R2_PRIVATE_BUCKET   the private bucket's name (same account and API token)
 */
const PRIVATE_BUCKET = process.env.R2_PRIVATE_BUCKET?.trim();
export const hasPrivateR2 = hasR2 && !!PRIVATE_BUCKET && PRIVATE_BUCKET !== BUCKET;

/**
 * The NAMES of the storage variables this process cannot see (never a value) — for the admin's worker check (owner,
 * 2026-10-30: "find which R2 variable the worker can't see"; the readiness answered only true/false).
 */
export function r2MissingEnv(env: Record<string, string | undefined> = process.env): string[] {
  const names = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL", "R2_PRIVATE_BUCKET"];
  const missing = names.filter((n) => !env[n]?.trim());
  if (!missing.includes("R2_PRIVATE_BUCKET") && env.R2_PRIVATE_BUCKET?.trim() === env.R2_BUCKET) missing.push("R2_PRIVATE_BUCKET (same as R2_BUCKET)");
  return missing;
}

function privateEndpoint(key: string): string {
  return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${PRIVATE_BUCKET}/${encodeURI(key)}`;
}

/** A short-lived upload URL into the private bucket. */
export async function presignPrivatePut(key: string, expiresSeconds = 300): Promise<string> {
  if (!hasPrivateR2) throw new Error("private storage is not configured");
  const url = new URL(privateEndpoint(key));
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  return (await r2().sign(url.toString(), { method: "PUT", aws: { signQuery: true } })).url;
}

/** A short-lived read URL for one private object. Call ONLY after an access check. */
export async function presignPrivateGet(key: string, expiresSeconds = 600): Promise<string> {
  if (!hasPrivateR2) throw new Error("private storage is not configured");
  const url = new URL(privateEndpoint(key));
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  return (await r2().sign(url.toString(), { method: "GET", aws: { signQuery: true } })).url;
}

/**
 * The first bytes of a private object and its total size, in ONE ranged read (Part 2: the
 * server checks what a creator uploaded before it is posted). `null` = the object does not
 * exist or storage could not answer; callers treat that as "refuse", never "allow".
 */
export async function readPrivatePrefix(key: string, bytes = 32): Promise<{ prefix: Uint8Array; size: number; contentType: string | null } | null> {
  if (!hasPrivateR2) return null;
  const res = await r2().fetch(privateEndpoint(key), { method: "GET", headers: { Range: `bytes=0-${bytes - 1}` } }).catch(() => null);
  if (!res || (res.status !== 206 && res.status !== 200)) return null;
  const total = Number(res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length") ?? NaN);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { prefix: buf.slice(0, bytes), size: total, contentType: res.headers.get("content-type") };
}

/** Remove a private object (a creator deleting a post). Best effort. */
export async function deletePrivate(key: string): Promise<void> {
  if (!hasPrivateR2) return;
  await r2().fetch(privateEndpoint(key), { method: "DELETE" }).catch(() => null);
}
