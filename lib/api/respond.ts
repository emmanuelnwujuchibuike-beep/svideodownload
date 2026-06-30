import { NextResponse } from "next/server";

import { withCors } from "@/lib/api/cors";

/**
 * The single response envelope every first-party endpoint (`/api/v1/app/*`)
 * returns, so web, iOS, Android and desktop all decode responses identically and
 * the client SDK can unwrap them generically.
 *
 *   success → { ok: true,  data: T, meta?: {...} }
 *   failure → { ok: false, error: { code, message, details? } }
 *
 * `code` is a stable, machine-readable string (see ERROR). Clients branch on the
 * code, never on the human `message`.
 */
export type ApiOk<T> = { ok: true; data: T; meta?: ResponseMeta };
export type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiEnvelope<T> = ApiOk<T> | ApiErr;

export interface ResponseMeta {
  /** Opaque cursor for the next page, or null when the list is exhausted. */
  nextCursor?: string | null;
  /** Echoed so clients can correlate logs with server traces. */
  requestId?: string;
}

/** Stable error codes. Keep in sync with the SDK's `ErrorCode`. */
export const ERROR = {
  bad_request: { status: 400, message: "The request was malformed." },
  unauthorized: { status: 401, message: "Authentication is required." },
  forbidden: { status: 403, message: "You don't have access to this resource." },
  not_found: { status: 404, message: "Not found." },
  conflict: { status: 409, message: "The request conflicts with current state." },
  validation_failed: { status: 422, message: "Validation failed." },
  rate_limited: { status: 429, message: "Too many requests." },
  quota_exceeded: { status: 429, message: "Your plan's quota is exhausted." },
  upstream_error: { status: 502, message: "An upstream service failed." },
  unavailable: { status: 503, message: "Temporarily unavailable." },
  internal: { status: 500, message: "Something went wrong." },
} as const;

export type ErrorCode = keyof typeof ERROR;

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

/** Success envelope (CORS + X-Request-Id applied). */
export function ok<T>(data: T, meta?: Omit<ResponseMeta, "requestId">, init?: ResponseInit): NextResponse {
  const requestId = newRequestId();
  const res = NextResponse.json({ ok: true, data, meta: { ...meta, requestId } } satisfies ApiOk<T>, init);
  res.headers.set("X-Request-Id", requestId);
  return withCors(res);
}

/** Error envelope keyed by a stable code; message/status come from ERROR unless overridden. */
export function fail(code: ErrorCode, message?: string, details?: unknown): NextResponse {
  const spec = ERROR[code];
  const requestId = newRequestId();
  const res = NextResponse.json(
    { ok: false, error: { code, message: message ?? spec.message, details } } satisfies ApiErr,
    { status: spec.status },
  );
  res.headers.set("X-Request-Id", requestId);
  return withCors(res);
}

/* ------------------------------- pagination ------------------------------- */

/**
 * Opaque cursor codec. Clients treat the cursor as a black box; internally it
 * currently encodes an offset, so we can move to keyset/seek pagination later
 * WITHOUT changing the wire contract or breaking any client.
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { o?: number };
    return Math.max(0, Math.floor(parsed.o ?? 0));
  } catch {
    return 0;
  }
}

/** Clamp a client-supplied page size into a safe range. */
export function clampLimit(raw: string | number | null | undefined, def = 12, max = 50): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : raw ?? def;
  if (!Number.isFinite(n) || (n as number) <= 0) return def;
  return Math.min(max, Math.max(1, Math.floor(n as number)));
}
