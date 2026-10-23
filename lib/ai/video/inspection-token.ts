import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { DetectedPerson } from "@/lib/ai/kling/features/person-replace-prompt";
import type { KlingVideoFacts } from "@/lib/ai/kling/features/shared";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A VIDEO THE WORKER MEASURED — the signed record the quote and the job trust
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The documented reference-video limits (frame size, aspect, frame rate,
 * length, container — KLING_OMNI.video) can only be checked on the FILE, and
 * Vercel has no ffprobe. So the worker measures it once, at upload (`video`)
 * or when the member opens Replace characters (`people`, which adds the
 * detected people), and the frontend signs what it said into a token the
 * browser carries back. The quote and the job read the facts from the token,
 * never from the browser's body.
 *
 *   · the key never leaves the server, so a client cannot mint or edit one;
 *   · it names its OWNER and storage PATH, so it cannot be replayed onto
 *     another member's object;
 *   · it carries the object's fingerprint (size:etag) — the job re-reads the
 *     object before charging, and a file replaced at the same path (the upload
 *     ticket is upsert) no longer matches;
 *   · it expires.
 *
 * Same key as the quote and preflight signatures: one secret, one place.
 */

export type InspectionKind = "video" | "people";

export interface InspectionClaims {
  kind: InspectionKind;
  userId: string;
  /** `<userId>/video-reference/<uuid>.<ext>` — the object the facts describe. */
  path: string;
  /** "size:etag" when measured. */
  fingerprint: string;
  facts: KlingVideoFacts;
  /** `people` only: who the detector found, and on which frame. */
  people?: DetectedPerson[];
  frameMs?: number;
  /** Unix ms. */
  expiresAt: number;
}

/** Long enough to choose people and photos; short enough that a stale measurement cannot linger. */
export const INSPECTION_TOKEN_TTL_MS = 3 * 60 * 60 * 1000;
const VERSION = 1;

function envKey(): string {
  const k = process.env.AI_QUOTE_SIGNING_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!k) throw new Error("no inspection signing key configured");
  return k;
}

const mac = (body: string, key: string) => createHmac("sha256", key).update(`inspect.v${VERSION}.${body}`).digest("base64url");

export function signInspection(claims: Omit<InspectionClaims, "expiresAt"> & { expiresAt?: number }, key: string = envKey(), now = Date.now()): { token: string; expiresAt: number } {
  const full: InspectionClaims = { ...claims, expiresAt: claims.expiresAt ?? now + INSPECTION_TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return { token: `${body}.${mac(body, key)}`, expiresAt: full.expiresAt };
}

export type InspectionVerdict = { ok: true; claims: InspectionClaims } | { ok: false; reason: "malformed" | "signature" | "expired" | "owner" | "kind" };

/** The signature, the clock, the owner and the kind — in that order, and nothing is read before the signature holds. */
export function verifyInspection(token: unknown, expected: { userId: string; kind?: InspectionKind }, key: string = envKey(), now = Date.now()): InspectionVerdict {
  if (typeof token !== "string" || token.length > 16_000) return { ok: false, reason: "malformed" };
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(body, key));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: "signature" };
  let claims: InspectionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as InspectionClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims.path !== "string" || !claims.facts) return { ok: false, reason: "malformed" };
  if (!Number.isFinite(claims.expiresAt) || claims.expiresAt <= now) return { ok: false, reason: "expired" };
  if (claims.userId !== expected.userId) return { ok: false, reason: "owner" };
  if (expected.kind && claims.kind !== expected.kind) return { ok: false, reason: "kind" };
  return { ok: true, claims };
}

/** The sentence a member reads for a token that no longer holds. */
export function inspectionRefusal(reason: Exclude<InspectionVerdict, { ok: true }>["reason"]): string {
  return reason === "expired" ? "Your video check has expired. Remove the video and attach it again." : "This video needs to be checked again. Remove it and attach it again.";
}
