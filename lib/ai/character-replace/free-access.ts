import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { getAdminUser } from "@/lib/admin/guard";
import type { CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { freeAccessLimitsView } from "@/lib/ai/character-replace/free-access-rules";
import type { CharacterReplaceQuote } from "@/lib/ai/character-replace/pricing";
import type { AiSubject } from "@/lib/ai/subject";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  COMPLIMENTARY CREATIONS — eligibility, the device, the atomic use (Part 11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-20: two complimentary Character Replace creations per
 * eligible account, lifetime; then pay per video. The device anti-abuse
 * exists to stop the offer being farmed with new accounts — never to block
 * paid processing, never to ban.
 *
 * ── The device (§9, §14) ──────────────────────────────────────────────────
 * A random id in a server-set, httpOnly cookie (`frenz_did`, 400 days). The
 * browser never reads it, JavaScript cannot forge it, localStorage has no
 * part in it, and it survives logout/login, PWA reopen, tabs and restarts
 * because it is a cookie on the site. What is STORED is an HMAC of it —
 * pseudonymous, keyed with a server secret — plus a coarse network hash
 * (the /24 and the browser family, hashed) as the secondary signal for the
 * short window in which one network mints many accounts. No raw fingerprint,
 * no IP, ever. A member who clears cookies gets a new device id; the network
 * hash is what catches the burst, and the grant count per network is small
 * and short-lived so a shared network is not punished (§11).
 *
 * ── One authoritative answer (§16) ────────────────────────────────────────
 * `getCharacterReplaceFreeEligibility` grants lazily (first eligibility
 * read), under the database's own lock per device, and answers with the
 * reason. Nothing a browser sends can change it: the member is the session,
 * the admin exemption is the dashboard's role check, the device is the
 * cookie the server set.
 */
export const DEVICE_COOKIE = "frenz_did";
const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
export const FREE_PRODUCT = "character_replace";

function key(): string {
  const k = process.env.AI_QUOTE_SIGNING_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!k) throw new Error("no signing key configured");
  return k;
}

function hmac(value: string, purpose: string): string {
  return createHmac("sha256", key()).update(`${purpose}:${value}`).digest("base64url").slice(0, 43);
}

/** The device id the browser carries, or null. Read from the raw Cookie header so it works in every route. */
export function readDeviceId(request: Request): string | null {
  const raw = request.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([A-Za-z0-9_-]{16,64})`));
  return m?.[1] ?? null;
}

export function newDeviceId(): string {
  return randomBytes(24).toString("base64url");
}

/** The Set-Cookie value that plants (or re-plants) the device id. httpOnly, secure, a year and change. */
export function deviceCookieHeader(id: string): string {
  return `${DEVICE_COOKIE}=${id}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function deviceHash(id: string | null): string | null {
  return id ? hmac(id, "device") : null;
}

/** The /24 (or the /48 for IPv6) plus the browser family — coarse on purpose. Null when no address is known. */
export function networkHash(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "";
  if (!forwarded) return null;
  let coarse: string;
  if (forwarded.includes(":")) coarse = forwarded.split(":").slice(0, 3).join(":");
  else coarse = forwarded.split(".").slice(0, 3).join(".");
  const ua = request.headers.get("user-agent") ?? "";
  const family = /iphone|ipad/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : /macintosh/i.test(ua) ? "mac" : /windows/i.test(ua) ? "win" : "other";
  return hmac(`${coarse}|${family}`, "network");
}

export type FreeEligibilityReason = "ELIGIBLE" | "FREE_USES_EXHAUSTED" | "DEVICE_LIMIT_REACHED" | "REQUIRES_VERIFICATION" | "ADMIN_EXEMPT" | "DISABLED_BY_ADMIN" | "ACCOUNT_NOT_ELIGIBLE";

export interface FreeEligibility {
  eligible: boolean;
  /** Null = unlimited (an administrator). */
  remainingFreeUses: number | null;
  granted: number;
  used: number;
  reason: FreeEligibilityReason;
  deviceRiskState: "normal" | "limit_reached" | "review" | "unknown";
  requiresVerification: boolean;
  /** The bounds a free creation must fit (display; /start re-checks). */
  limits: ReturnType<typeof freeAccessLimitsView>;
}

/**
 * The one authoritative eligibility read. Grants on first sight (the row is
 * the member's forever after), answers from the row every later time.
 */
export async function getCharacterReplaceFreeEligibility(opts: {
  subject: AiSubject;
  config: CharacterReplaceConfig;
  request: Request;
  /** Pre-resolved when the caller already checked; otherwise the dashboard's role check runs here. */
  isAdmin?: boolean;
}): Promise<FreeEligibility> {
  const { config } = opts;
  const limits = freeAccessLimitsView(config);
  const off = (reason: FreeEligibilityReason): FreeEligibility => ({ eligible: false, remainingFreeUses: 0, granted: 0, used: 0, reason, deviceRiskState: "unknown", requiresVerification: false, limits });
  if (opts.subject.kind !== "user") return off("ACCOUNT_NOT_ELIGIBLE");
  if (!config.freeAccess.enabled || config.freeAccess.creationsPerAccount <= 0) return off("DISABLED_BY_ADMIN");

  const isAdmin = opts.isAdmin ?? (config.antiAbuse.adminExempt ? !!(await getAdminUser().catch(() => null)) : false);
  if (isAdmin && config.antiAbuse.adminExempt) {
    return { eligible: true, remainingFreeUses: null, granted: 0, used: 0, reason: "ADMIN_EXEMPT", deviceRiskState: "normal", requiresVerification: false, limits };
  }

  const detect = config.antiAbuse.deviceDetection;
  const dHash = detect ? deviceHash(readDeviceId(opts.request)) : null;
  const nHash = detect ? networkHash(opts.request) : null;
  const { data, error } = await createAdminClient().rpc("grant_free_entitlement", {
    p_user_id: opts.subject.userId,
    p_product: FREE_PRODUCT,
    p_count: config.freeAccess.creationsPerAccount,
    p_device_hash: dHash,
    p_network_hash: nHash,
    p_max_per_device: detect ? config.antiAbuse.maxFreeAccountsPerDevice : 0,
    p_max_per_network: detect ? config.antiAbuse.maxFreeAccountsPerNetwork : 0,
    p_network_window: `${config.antiAbuse.networkWindowHours} hours`,
    p_exempt: false,
  });
  if (error) {
    // 0162 not applied yet, or a database fault: no free creation is granted blind, and paid processing is unaffected.
    console.error("[cr/free] eligibility read failed", { userId: opts.subject.userId, code: error.code, message: error.message });
    return off("ACCOUNT_NOT_ELIGIBLE");
  }
  const row = (Array.isArray(data) ? data[0] : data) as { granted: number; used: number; restored: number; eligibility: string } | undefined;
  if (!row) return off("ACCOUNT_NOT_ELIGIBLE");
  const remaining = Math.max(0, Number(row.granted) - Number(row.used));
  if (row.eligibility === "device_limit") {
    return { eligible: false, remainingFreeUses: 0, granted: 0, used: 0, reason: config.antiAbuse.verificationAfterLimit ? "REQUIRES_VERIFICATION" : "DEVICE_LIMIT_REACHED", deviceRiskState: "limit_reached", requiresVerification: config.antiAbuse.verificationAfterLimit, limits };
  }
  if (row.eligibility === "review" || row.eligibility === "pending") return { eligible: false, remainingFreeUses: 0, granted: 0, used: 0, reason: "ACCOUNT_NOT_ELIGIBLE", deviceRiskState: row.eligibility === "pending" ? "unknown" : "review", requiresVerification: false, limits };
  if (row.eligibility !== "eligible") return { ...off("ACCOUNT_NOT_ELIGIBLE"), granted: Number(row.granted), used: Number(row.used) };
  return {
    eligible: remaining > 0,
    remainingFreeUses: remaining,
    granted: Number(row.granted),
    used: Number(row.used),
    reason: remaining > 0 ? "ELIGIBLE" : "FREE_USES_EXHAUSTED",
    deviceRiskState: "normal",
    requiresVerification: false,
    limits,
  };
}

/** The member's words for a verdict (§6, §20). Never an internal mechanism. */
export function freeEligibilityMessage(e: FreeEligibility): string {
  switch (e.reason) {
    case "ADMIN_EXEMPT":
      return "Complimentary creations for this account.";
    case "ELIGIBLE":
      return e.remainingFreeUses === 1 ? "1 complimentary creation remaining" : `${e.remainingFreeUses} complimentary creations remaining`;
    case "FREE_USES_EXHAUSTED":
      return "Your complimentary creations are used.";
    case "DEVICE_LIMIT_REACHED":
      return "This device has reached the complimentary Character Replace limit.";
    case "REQUIRES_VERIFICATION":
      return "This device has reached the complimentary Character Replace limit. Continue with a funded Character Replace balance or complete verification.";
    case "DISABLED_BY_ADMIN":
    case "ACCOUNT_NOT_ELIGIBLE":
      return "Complimentary creations aren't available on this account.";
  }
}

/* ───────────────────────── the atomic use ─────────────────────────────── */

export type FreeUseOutcome = { ok: true; useNumber: number; remaining: number; already: boolean } | { ok: false; reason: "none" | "exhausted" | "restored" | "error"; remaining: number };

/** Consume one complimentary creation for a job — atomic in the database, one per job, refused when exhausted. */
export async function consumeFreeUse(opts: { userId: string; jobId: string; snapshot: CharacterReplaceQuote & Record<string, unknown> }): Promise<FreeUseOutcome> {
  const { data, error } = await createAdminClient().rpc("consume_free_use", {
    p_user_id: opts.userId,
    p_product: FREE_PRODUCT,
    p_job_id: opts.jobId,
    p_mode: opts.snapshot.mode,
    p_quality: opts.snapshot.quality,
    p_duration_ms: opts.snapshot.durationMs,
    p_normal_price: opts.snapshot.totalCents,
    p_currency: opts.snapshot.currency,
    p_snapshot: { ...opts.snapshot, billingType: "FREE_TRIAL", normalPriceCents: opts.snapshot.totalCents, chargedCents: 0, freeEntitlementUsed: 1 },
  });
  if (error) {
    console.error("[cr/free] consume failed", { jobId: opts.jobId, message: error.message });
    return { ok: false, reason: "error", remaining: 0 };
  }
  const r = (data ?? {}) as { ok?: boolean; use_number?: number; remaining?: number; already?: boolean; reason?: string };
  if (r.ok) return { ok: true, useNumber: Number(r.use_number ?? 0), remaining: Number(r.remaining ?? 0), already: r.already === true };
  return { ok: false, reason: (r.reason === "none" || r.reason === "restored" ? r.reason : "exhausted") as "none" | "exhausted" | "restored", remaining: Number(r.remaining ?? 0) };
}

/** Give a complimentary creation back — at most once per job, whoever calls. Never throws. */
export async function restoreFreeUse(jobId: string, reason?: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("restore_free_use", { p_job_id: jobId, p_reason: reason ?? null });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (e) {
    console.error("[cr/free] restore failed", { jobId, error: String(e) });
    return false;
  }
}

export async function settleFreeUse(jobId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("settle_free_use", { p_job_id: jobId });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (e) {
    console.error("[cr/free] settle failed", { jobId, error: String(e) });
    return false;
  }
}

/** Whether a job's complimentary creation stands, came back, or was never one — from the audit row, never a status. */
export type FreeUseState = "none" | "consumed" | "settled" | "restored";

export async function freeUseState(jobId: string): Promise<FreeUseState> {
  try {
    const { data } = await createAdminClient().from("ai_free_uses").select("status").eq("job_id", jobId).maybeSingle();
    const s = (data as { status?: string } | null)?.status;
    return s === "consumed" || s === "settled" || s === "restored" ? s : "none";
  } catch {
    return "none";
  }
}

export async function freeUseStates(jobIds: readonly string[]): Promise<Map<string, FreeUseState>> {
  const out = new Map<string, FreeUseState>();
  if (!jobIds.length) return out;
  try {
    const { data } = await createAdminClient().from("ai_free_uses").select("job_id, status").in("job_id", [...jobIds]);
    for (const row of (data ?? []) as { job_id: string; status: string }[]) out.set(row.job_id, (row.status as FreeUseState) ?? "none");
  } catch {
    /* an unreadable audit leaves "none" */
  }
  return out;
}
