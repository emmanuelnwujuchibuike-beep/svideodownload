import "server-only";

import { randomBytes } from "node:crypto";

import { pushRewards, type GrantedReward } from "@/lib/rewards/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE REFERRAL ATTRIBUTION SYSTEM — share links, clicks, signups
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief "credit, referral and reward — part 1" §6–§8 (2026-10-07).
 *
 *   share   a member asks for a link to THEIR content (a profile, a post or
 *           reel, an AI video or audio, or a plain app invite). Ownership is
 *           checked here; the link is a random token — never a raw user id —
 *           and the same (owner, content) always gets the same token.
 *   click   /r/<token> counts the click and leaves the token in an httpOnly
 *           first-party cookie (`frenz_ref`, 30 days) plus a readable
 *           `frenz_ref_pending` flag, then sends the visitor to the content.
 *   claim   when a NEW account signs in for the first time (the auth callback,
 *           or the app shell when sign-up did not pass through it), the token
 *           becomes an attribution — once per member, never to themselves,
 *           never in a loop, only for an account created within the window —
 *           and the `account_created` reward is processed by the ONE engine.
 *
 * IP addresses are not used for attribution at all.
 */
export const REF_COOKIE = "frenz_ref";
export const REF_PENDING_COOKIE = "frenz_ref_pending";
export const REF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export type ShareContentType = "profile" | "post" | "reel" | "ai_video" | "ai_audio" | "app";
export const SHARE_CONTENT_TYPES: readonly ShareContentType[] = ["profile", "post", "reel", "ai_video", "ai_audio", "app"];

/** 22 url-safe characters of randomness — unguessable, and nothing about the owner in it. */
export function newShareToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Does this member own this content? The browser's word is never enough. */
async function ownsContent(ownerId: string, type: ShareContentType, contentId: string): Promise<{ ok: true; aiJobId: string | null } | { ok: false }> {
  const db = createAdminClient();
  if (type === "app") return contentId === "app" ? { ok: true, aiJobId: null } : { ok: false };
  if (type === "profile") return contentId === ownerId ? { ok: true, aiJobId: null } : { ok: false };
  if (type === "post" || type === "reel" || type === "ai_video") {
    const { data } = await db.from("posts").select("publisher_id, ai_job_id, content_type").eq("id", contentId).maybeSingle();
    const p = data as { publisher_id: string; ai_job_id: string | null; content_type: string } | null;
    if (!p || p.publisher_id !== ownerId) return { ok: false };
    if (type === "ai_video" && p.content_type !== "ai_video") return { ok: false };
    return { ok: true, aiJobId: p.ai_job_id };
  }
  if (type === "ai_audio") {
    const { data } = await db.from("ai_jobs").select("user_id, feature, status").eq("id", contentId).maybeSingle();
    const j = data as { user_id: string; feature: string; status: string } | null;
    return j && j.user_id === ownerId && j.feature === "ai_text_to_audio" && j.status === "completed" ? { ok: true, aiJobId: contentId } : { ok: false };
  }
  return { ok: false };
}

/** The member's link for this content — created once, the same token after. */
export async function getOrCreateShareLink(ownerId: string, type: ShareContentType, contentId: string): Promise<{ ok: true; token: string } | { ok: false; reason: "not_yours" | "error" }> {
  const owned = await ownsContent(ownerId, type, contentId);
  if (!owned.ok) return { ok: false, reason: "not_yours" };
  const db = createAdminClient();
  const existing = await db.from("share_links").select("token").eq("owner_id", ownerId).eq("content_type", type).eq("content_id", contentId).maybeSingle();
  if ((existing.data as { token?: string } | null)?.token) return { ok: true, token: (existing.data as { token: string }).token };
  const token = newShareToken();
  const { error } = await db.from("share_links").insert({ token, owner_id: ownerId, content_type: type, content_id: contentId, ai_job_id: owned.aiJobId });
  if (error) {
    // a concurrent request made it first — answer that one
    const again = await db.from("share_links").select("token").eq("owner_id", ownerId).eq("content_type", type).eq("content_id", contentId).maybeSingle();
    const t = (again.data as { token?: string } | null)?.token;
    if (t) return { ok: true, token: t };
    console.error("[referrals] link create failed", { ownerId, type, message: error.message });
    return { ok: false, reason: "error" };
  }
  return { ok: true, token };
}

/** Where a click on a link should land. Unknown content lands on the home page — never a dead end. */
export async function destinationFor(type: string, contentId: string): Promise<string> {
  if (type === "post" || type === "reel" || type === "ai_video") return `/p/${encodeURIComponent(contentId)}`;
  if (type === "profile") {
    const { data } = await createAdminClient().from("profiles").select("handle").eq("id", contentId).maybeSingle();
    const handle = (data as { handle?: string | null } | null)?.handle;
    return handle ? `/u/${encodeURIComponent(handle)}` : "/";
  }
  if (type === "ai_audio") return "/ai";
  return "/";
}

export function isShareToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);
}

/**
 * Turn a pending click into an attribution for a member who just signed in.
 * Safe to call more than once: the database answers "already attributed".
 * The `account_created` reward the engine granted (if the operator set one)
 * is pushed here, after the commit.
 */
export async function claimReferral(userId: string, token: string, windowDays: number): Promise<{ ok: boolean; reason?: string; referrerId?: string | null }> {
  if (!isShareToken(token)) return { ok: false, reason: "bad_token" };
  const { data, error } = await createAdminClient().rpc("attribute_referral", { p_referred: userId, p_token: token, p_window_days: windowDays });
  if (error) {
    console.error("[referrals] claim failed", { userId, message: error.message });
    return { ok: false, reason: "error" };
  }
  const out = (data ?? {}) as { ok?: boolean; reason?: string; referrer_id?: string; rewards?: GrantedReward[] };
  if (out.ok) {
    console.info("[referrals] attributed", { referred: userId, referrer: out.referrer_id });
    if (Array.isArray(out.rewards) && out.rewards.length) void pushRewards(out.rewards);
  }
  return { ok: !!out.ok, reason: out.reason, referrerId: out.referrer_id ?? null };
}
