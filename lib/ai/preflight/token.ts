import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { ReplacementMode } from "@/lib/ai/character-replace/modes";

import { PREFLIGHT_TOKEN_TTL_MS, PREFLIGHT_VALIDATOR_VERSION } from "./config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — the short-lived pass a member hands back at Start (brief §13)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The truth is the record the worker stored on the job row; the token is
 * the member's proof that they saw a PASS for exactly these files, this mode
 * and this validator. Start verifies BOTH: the signature here, and the
 * stored record against the objects as they are at that moment. A modified
 * client cannot mint one (the key never leaves the server), and a replaced
 * file changes the object's fingerprint, so an older pass no longer matches.
 *
 * Same key as the quote signature (wallet.ts): one secret, one place.
 */
export interface PreflightTokenClaims {
  jobId: string;
  userId: string;
  mode: ReplacementMode;
  validatorVersion: number;
  /** The reference photo's storage fingerprint — size and etag — at validation time. */
  reference: string;
  /** The video's. */
  video: string;
  /** Unix ms. */
  expiresAt: number;
}

function key(): string {
  const k = process.env.AI_QUOTE_SIGNING_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!k) throw new Error("no preflight signing key configured");
  return k;
}

/** "size:etag" — what a replaced file cannot keep. */
export function objectFingerprint(o: { size: number; etag: string | null } | null): string {
  return o ? `${o.size}:${o.etag ?? "-"}` : "-";
}

function canonical(c: PreflightTokenClaims): string {
  return JSON.stringify({ j: c.jobId, u: c.userId, m: c.mode, v: c.validatorVersion, r: c.reference, s: c.video, e: c.expiresAt });
}

export function signPreflightToken(c: Omit<PreflightTokenClaims, "expiresAt" | "validatorVersion"> & { expiresAt?: number }): { token: string; expiresAt: number } {
  const claims: PreflightTokenClaims = { ...c, validatorVersion: PREFLIGHT_VALIDATOR_VERSION, expiresAt: c.expiresAt ?? Date.now() + PREFLIGHT_TOKEN_TTL_MS };
  const body = Buffer.from(canonical(claims)).toString("base64url");
  const mac = createHmac("sha256", key()).update(body).digest("base64url");
  return { token: `${body}.${mac}`, expiresAt: claims.expiresAt };
}

export type PreflightTokenVerdict = { ok: true; claims: PreflightTokenClaims } | { ok: false; reason: "malformed" | "signature" | "expired" | "mismatch" };

/** The signature, the clock, and every claim against what Start knows now. */
export function verifyPreflightToken(token: string, expected: Omit<PreflightTokenClaims, "expiresAt" | "validatorVersion">, now = Date.now()): PreflightTokenVerdict {
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  let claims: PreflightTokenClaims;
  try {
    const raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { j: string; u: string; m: ReplacementMode; v: number; r: string; s: string; e: number };
    claims = { jobId: raw.j, userId: raw.u, mode: raw.m, validatorVersion: raw.v, reference: raw.r, video: raw.s, expiresAt: raw.e };
  } catch {
    return { ok: false, reason: "malformed" };
  }
  try {
    const expectedMac = Buffer.from(createHmac("sha256", key()).update(body).digest("base64url"));
    const given = Buffer.from(mac);
    if (expectedMac.length !== given.length || !timingSafeEqual(expectedMac, given)) return { ok: false, reason: "signature" };
  } catch {
    return { ok: false, reason: "signature" };
  }
  if (!Number.isFinite(claims.expiresAt) || claims.expiresAt <= now) return { ok: false, reason: "expired" };
  if (claims.jobId !== expected.jobId || claims.userId !== expected.userId || claims.mode !== expected.mode || claims.validatorVersion !== PREFLIGHT_VALIDATOR_VERSION || claims.reference !== expected.reference || claims.video !== expected.video) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, claims };
}
