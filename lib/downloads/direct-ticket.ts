import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { downloadRequestSchema, type DownloadRequest } from "@/lib/validation";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIRECT DOWNLOAD TICKETS — the file's bytes skip Vercel (FOT brief, 2026-10-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Before: browser → Vercel /api/download → Railway worker → Vercel → browser.
 * Every byte of every download crossed Vercel twice (Fast Origin Transfer),
 * although Vercel does no work on them: `proxyToWorker` only pipes the body.
 *
 * After (opt-in, see `directDownloadsEnabled`): Vercel does everything it did
 * before the bytes — rate limit, daily quota, reward redemption, analytics —
 * and then answers a few hundred bytes of JSON holding a ticket. The browser
 * takes the ticket straight to the worker, which verifies it and streams.
 *
 * ── Why this is not weaker than the proxy ─────────────────────────────────────
 *  · A ticket is HMAC-SHA256 over its payload with WORKER_SECRET, the secret
 *    the worker already trusts. Nothing in it can be altered: the URL, format
 *    and kind are the ones Vercel authorised (for a reward download, the ones
 *    read from the server-stored reward session — never from the query).
 *  · It expires in TICKET_TTL_MS. Within that window a replay re-runs the
 *    SAME authorised download, which is what an automatic retry of the old
 *    path did too; the worker's own per-IP limiter still applies to it.
 *  · No secret reaches the browser: only the signature does.
 */

export const TICKET_TTL_MS = 2 * 60 * 1000;

export interface DirectTicketPayload {
  data: DownloadRequest;
  /** The client can decode HEVC (passed through unchanged, see /api/download). */
  hevc: boolean;
  /** The caller's IP as Vercel saw it — for the worker's limiter key, not a binding. */
  ip: string;
  /** The caller's size cap as capToHeader wrote it ("none" for paid plans). */
  maxBytes: string;
  /** Expiry, epoch ms. */
  exp: number;
  /** Uniqueness only. */
  n: string;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function mintDirectTicket(
  input: { data: DownloadRequest; hevc: boolean; ip: string; maxBytes: string },
  secret: string,
  now = Date.now(),
): { ticket: string; expiresAt: string } {
  if (!secret) throw new Error("A direct ticket needs WORKER_SECRET.");
  const payload: DirectTicketPayload = { ...input, exp: now + TICKET_TTL_MS, n: randomBytes(9).toString("base64url") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { ticket: `${body}.${sign(body, secret)}`, expiresAt: new Date(payload.exp).toISOString() };
}

/** The payload, or null for anything forged, altered, expired or malformed. */
export function verifyDirectTicket(ticket: string | null, secret: string, now = Date.now()): DirectTicketPayload | null {
  if (!ticket || !secret || ticket.length > 4096) return null;
  const dot = ticket.indexOf(".");
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  const given = Buffer.from(ticket.slice(dot + 1));
  const expected = Buffer.from(sign(body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const p = raw as Partial<DirectTicketPayload>;
  if (typeof p.exp !== "number" || p.exp <= now) return null;
  // re-validated, so a signed ticket can still never carry what the route would refuse
  const data = downloadRequestSchema.safeParse(p.data);
  if (!data.success) return null;
  return { data: data.data, hevc: p.hevc === true, ip: typeof p.ip === "string" ? p.ip : "unknown", maxBytes: typeof p.maxBytes === "string" ? p.maxBytes : "", exp: p.exp, n: String(p.n ?? "") };
}

/**
 * On (the Vercel role) only when explicitly switched on AND the worker can
 * verify: `DOWNLOAD_DIRECT=1`, a worker URL and a secret. Off by default
 * because the worker must first be redeployed with /api/download/direct —
 * turning this on against an old worker would hand browsers a 404.
 */
export function directDownloadsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DOWNLOAD_DIRECT === "1" && !!env.DOWNLOAD_WORKER_URL && !!env.WORKER_SECRET;
}

/** The worker's address as a BROWSER reaches it (may differ from the server-to-server one). */
export function directWorkerBase(env: Record<string, string | undefined> = process.env): string {
  return (env.DOWNLOAD_WORKER_PUBLIC_URL || env.DOWNLOAD_WORKER_URL || "").replace(/\/$/, "");
}

/** Origins the worker answers CORS for: the site, plus any listed in DOWNLOAD_DIRECT_ORIGINS. */
export function directAllowedOrigin(origin: string | null, env: Record<string, string | undefined> = process.env): string | null {
  if (!origin) return null;
  const allowed = new Set(["https://frenzsave.com", "https://www.frenzsave.com"]);
  for (const o of (env.DOWNLOAD_DIRECT_ORIGINS ?? "").split(",")) if (o.trim()) allowed.add(o.trim().replace(/\/$/, ""));
  return allowed.has(origin) ? origin : null;
}
