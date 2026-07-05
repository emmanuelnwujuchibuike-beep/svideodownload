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

// trim() — a trailing space/newline from copy-paste silently breaks the
// Authorization header and reads as "Authentication error" (seen in prod).
const ACCOUNT_ID = process.env.CF_STREAM_ACCOUNT_ID?.trim();
const API_TOKEN = process.env.CF_STREAM_API_TOKEN?.trim();

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
      // Surface Cloudflare's own error code/message (e.g. 9109 "Invalid API Token")
      // so the fix is obvious instead of just a bare status number.
      let detail = "";
      try {
        const body = (await res.json()) as { errors?: { code?: number; message?: string }[] };
        const first = body.errors?.[0];
        if (first) detail = ` (${first.code ?? "?"}: ${first.message ?? ""})`;
      } catch {
        /* non-JSON error body */
      }
      // Auth failures: distinguish "the token string is wrong" from "the token
      // is fine but lacks Stream permission / wrong account id" by asking
      // Cloudflare to verify the raw token.
      if (res.status === 401 || res.status === 403) {
        try {
          const v = await fetch(`${API_BASE}/user/tokens/verify`, {
            headers: { Authorization: `Bearer ${API_TOKEN}` },
            signal: AbortSignal.timeout(5000),
          });
          detail += v.ok
            ? " | token itself is VALID → the token lacks the Stream permission for THIS account, or CF_STREAM_ACCOUNT_ID is a different account's id"
            : " | token string is INVALID → the pasted value isn't the token secret (did you paste the token ID or add a space?)";
        } catch {
          /* verify unreachable — keep the base detail */
        }
      }
      return { configured, ok: false, latencyMs, customerCode, error: `Cloudflare ${res.status}${detail}` };
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
 * Ask Cloudflare Stream to auto-generate captions for a video in `language`
 * (default English). Best-effort + fire-and-forget: generated captions are exposed
 * as a subtitle rendition in the HLS manifest, so native HLS and hls.js render them
 * automatically (accessibility) with no player changes. Safe to call after ingest;
 * Cloudflare queues it until the video finishes processing.
 */
export async function generateStreamCaptions(uid: string, language = "en"): Promise<boolean> {
  if (!hasStream) return false;
  try {
    const res = await fetch(
      `${API_BASE}/accounts/${ACCOUNT_ID}/stream/${encodeURIComponent(uid)}/captions/${encodeURIComponent(language)}/generate`,
      { method: "POST", headers: { Authorization: `Bearer ${API_TOKEN}` } },
    );
    return res.ok;
  } catch {
    return false;
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
