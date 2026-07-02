/**
 * Cloudflare Stream — adaptive-bitrate video for instant, TikTok-style playback.
 *
 * Stored files in R2 download the whole file before playing; Stream instead serves
 * HLS/DASH with automatic quality ladders and range-based startup, so a reel starts
 * almost immediately and adapts to the viewer's connection. A post that has a Stream
 * `uid` plays through {@link streamIframeUrl}/{@link streamHlsUrl}; anything without
 * one keeps using the plain R2/Supabase `<video src>` — so this is fully additive.
 *
 * Playback URLs are public and need no secrets. Uploading (creating a direct-upload
 * ticket, or pulling an existing R2 URL into Stream) uses the API token server-side.
 * See docs/INFRASTRUCTURE.md.
 */

const ACCOUNT_ID = process.env.CF_STREAM_ACCOUNT_ID;
const API_TOKEN = process.env.CF_STREAM_API_TOKEN;

/** Is Cloudflare Stream provisioned (server-side upload/copy available)? */
export const hasStream = !!ACCOUNT_ID && !!API_TOKEN;

/** Cross-account iframe embed — adaptive bitrate, no customer code required. */
export function streamIframeUrl(uid: string): string {
  return `https://iframe.cloudflarestream.com/${encodeURIComponent(uid)}`;
}

/**
 * HLS manifest for a custom `<video>`/hls.js player. Needs the account's public
 * customer code (safe to expose) — `NEXT_PUBLIC_CF_STREAM_CUSTOMER_CODE`.
 */
export function streamHlsUrl(uid: string): string | null {
  const code = process.env.NEXT_PUBLIC_CF_STREAM_CUSTOMER_CODE;
  if (!code) return null;
  return `https://customer-${code}.cloudflarestream.com/${encodeURIComponent(uid)}/manifest/video.m3u8`;
}

/** Auto-generated poster/thumbnail for a Stream video (public). */
export function streamThumbnailUrl(uid: string, opts: { time?: string } = {}): string | null {
  const code = process.env.NEXT_PUBLIC_CF_STREAM_CUSTOMER_CODE;
  if (!code) return null;
  const time = opts.time ?? "1s";
  return `https://customer-${code}.cloudflarestream.com/${encodeURIComponent(uid)}/thumbnails/thumbnail.jpg?time=${encodeURIComponent(time)}`;
}

const API_BASE = "https://api.cloudflare.com/client/v4";

export interface StreamHealth {
  /** Are the account id + token env vars present? */
  configured: boolean;
  /** Did a live call to the Stream API with the token succeed? */
  ok: boolean;
  latencyMs: number | null;
  /** Also confirms the public customer code (needed for HLS/thumbnails) is set. */
  customerCode: boolean;
  error?: string;
}

/**
 * Verifies Stream is reachable with the configured credentials — used by
 * /api/health so the token can be validated on the deployment where it's set
 * (the secret never leaves the server). Lists at most one video as a cheap ping.
 */
export async function checkStream(): Promise<StreamHealth> {
  const configured = hasStream;
  const customerCode = !!process.env.NEXT_PUBLIC_CF_STREAM_CUSTOMER_CODE;
  if (!configured) return { configured, ok: false, latencyMs: null, customerCode };
  try {
    const started = performance.now();
    const res = await fetch(`${API_BASE}/accounts/${ACCOUNT_ID}/stream?limit=1`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) {
      return { configured, ok: false, latencyMs, customerCode, error: `Cloudflare ${res.status}` };
    }
    return { configured, ok: true, latencyMs, customerCode };
  } catch (e) {
    return {
      configured,
      ok: false,
      latencyMs: null,
      customerCode,
      error: e instanceof Error ? e.message : "stream probe failed",
    };
  }
}

interface DirectUpload {
  uid: string;
  uploadURL: string;
}

/**
 * Create a one-time direct-upload URL so the browser can upload a video straight to
 * Cloudflare Stream (no bytes through our server). Returns the `uid` to persist on
 * the post and the `uploadURL` to POST the file to.
 */
export async function createStreamDirectUpload(opts: {
  maxDurationSeconds?: number;
  creatorId?: string;
} = {}): Promise<DirectUpload | null> {
  if (!hasStream) return null;
  try {
    const res = await fetch(`${API_BASE}/accounts/${ACCOUNT_ID}/stream/direct_upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        maxDurationSeconds: opts.maxDurationSeconds ?? 3600,
        ...(opts.creatorId ? { creator: opts.creatorId } : {}),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: DirectUpload };
    return json.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Pull an already-stored video (e.g. an R2 public URL) into Cloudflare Stream by
 * URL. Returns the new Stream `uid`. Useful for backfilling existing posts so they
 * gain instant adaptive playback without a re-upload from the client.
 */
export async function copyToStream(sourceUrl: string, creatorId?: string): Promise<string | null> {
  if (!hasStream) return null;
  try {
    const res = await fetch(`${API_BASE}/accounts/${ACCOUNT_ID}/stream/copy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: sourceUrl, ...(creatorId ? { creator: creatorId } : {}) }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: { uid?: string } };
    return json.result?.uid ?? null;
  } catch {
    return null;
  }
}
