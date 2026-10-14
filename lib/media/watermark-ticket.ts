import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A signed, short-lived pass for the worker to burn a watermark into ONE
 * post video (owner, 2026-10-14: feed/reels downloads carry the creator's
 * @handle and the Frenzsave mark; only Pro and up may take the clean file).
 *
 * Vercel's /api/posts/:id/download decides — plan, daily cap, visibility —
 * then mints this. The browser takes it to the worker, which has ffmpeg and
 * verifies it with the WORKER_SECRET both sides already share; nothing in it
 * can be altered, and it expires. Same construction as the direct download
 * ticket (lib/downloads/direct-ticket.ts).
 */

export const WATERMARK_TICKET_TTL_MS = 10 * 60 * 1000;

export interface WatermarkTicketPayload {
  /** The stored post video. */
  src: string;
  /** The creator's handle, without "@". */
  handle: string;
  /** The saved file's name. */
  name: string;
  exp: number;
  n: string;
}

/** What a handle may contain on the mark — anything else is dropped. */
export function cleanHandle(handle: string | null | undefined): string {
  return (handle ?? "").replace(/^@/, "").replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 30);
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function mintWatermarkTicket(
  input: { src: string; handle: string; name: string },
  secret: string,
  now = Date.now(),
): string {
  if (!secret) throw new Error("A watermark ticket needs WORKER_SECRET.");
  const payload: WatermarkTicketPayload = {
    src: input.src,
    handle: cleanHandle(input.handle),
    name: input.name,
    exp: now + WATERMARK_TICKET_TTL_MS,
    n: randomBytes(9).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** The payload, or null for anything forged, altered, expired or malformed. */
export function verifyWatermarkTicket(ticket: string | null, secret: string, now = Date.now()): WatermarkTicketPayload | null {
  if (!ticket || !secret || ticket.length > 4096) return null;
  const dot = ticket.indexOf(".");
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  const given = Buffer.from(ticket.slice(dot + 1));
  const expected = Buffer.from(sign(body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let p: Partial<WatermarkTicketPayload>;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<WatermarkTicketPayload>;
  } catch {
    return null;
  }
  if (typeof p.exp !== "number" || p.exp <= now) return null;
  if (typeof p.src !== "string" || !/^https:\/\//i.test(p.src)) return null;
  const handle = cleanHandle(p.handle);
  if (!handle) return null;
  const name = typeof p.name === "string" && p.name ? p.name.replace(/[^\w.-]/g, "").slice(0, 80) || "frenz.mp4" : "frenz.mp4";
  return { src: p.src, handle, name, exp: p.exp, n: String(p.n ?? "") };
}
