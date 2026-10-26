import "server-only";

import { createHash, createHmac } from "node:crypto";

import { SITE_URL } from "@/lib/site";
import { TOKEN_RE } from "@/lib/email/token-format";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email consent (Frenzsave Part 11, migration 0253): one global switch for OPTIONAL product email,
 * checked at send time, and a one-click unsubscribe that needs no sign-in.
 *
 * ── Every email this app sends, classified ──────────────────────────────────
 * OPTIONAL — the member could live without it; the global switch silences it:
 *   exclusive_announcement     a creator posted an announcement for subscribers (Part 6 fan-out)
 *   exclusive_private_post     a creator posted a private post (fan-out, and the older private-notify path)
 *   creator_new_subscriber     "X subscribed to your content" to the creator (the in-app row and the
 *                              earnings are unaffected — the email is a courtesy copy)
 *   creator_new_member         "X joined your community"
 *   subscription_renewal       "renew soon" / "your access ended" reminders. 🟡 REVIEW: they concern
 *                              something the member paid for, but every subscription is a one-off
 *                              payment that never auto-renews, the reminder's job is to sell the next
 *                              period, and the same facts are in-app and on /account/subscriptions —
 *                              so they are treated as optional, the safer reading.
 *   ad_slot_waitlist           "an ad slot is open — create your campaign": the member asked for it,
 *                              but it is an invitation to buy, not a record of anything they did.
 *   new_message                a chat message waiting for them (0262): at most one per unread batch,
 *                              never while they are in the chat, and switchable off in the chat once
 *                              they have push (lib/social/message-email.ts).
 *
 * TRANSACTIONAL — the record of something the member did or that happened to their money or
 * account; not silenced:
 *   credits_received           credits another member sent them (wallet transfer)
 *   withdrawal_decision        approval / refusal of a withdrawal application
 *   withdrawal_update          a withdrawal's status changed (paid, failed, rejected)
 *   ai_video_ready             🟡 REVIEW: the result of a paid job they started is ready and kept for a
 *                              limited time; treated as service notice (transactional). The owner can
 *                              move it to optional by changing one line here.
 *   (direct senders, not through emailMember)
 *   topup_receipt              Frenz AI deposit receipt / decline (lib/ai/topup-notify.ts)
 *   ad_campaign_notice         status of a PAID ad campaign — approved, rejected, refunds, ending
 *                              (lib/ads-platform/ad-notify.ts notifyAdvertiser)
 *   support_reply              the team answered the member's own message (lib/support/chat.ts)
 *
 * SECURITY — never silenced:
 *   sign_in_code               the one-time sign-in code (app/api/auth/otp)
 *
 * Nothing here is promotional/marketing email: the app sends none today. If one is added it is
 * OPTIONAL by definition, never transactional.
 *
 * ── The switch ──────────────────────────────────────────────────────────────
 * notification_settings.optional_email (default true). No row, or a database from before 0253,
 * reads as allowed — nobody had a global switch to have turned off, and each member's per-creator
 * email choices (creator_notification_prefs) still decide whether a creator emails them at all.
 * Any OTHER read failure reads as NOT allowed: an optional email is never sent on a guess.
 *
 * ── The unsubscribe token ───────────────────────────────────────────────────
 * HMAC-SHA256 of a fixed label and the member id under a server key — 43 base64url characters,
 * unguessable, carrying no id or address. The table keeps only SHA-256(token) -> member, so a copy
 * of the table is not a set of working links. The key is EMAIL_UNSUBSCRIBE_SECRET when set, else
 * derived from the service-role key (already in every environment — no new variable, no redeploy).
 * Rotating either key changes future links; links already sent keep working through their stored
 * hash until the row is replaced by the member's next optional email.
 */

export type EmailCategory = "optional" | "transactional" | "security";

export const MEMBER_EMAIL_KINDS = {
  exclusive_announcement: "optional",
  exclusive_private_post: "optional",
  creator_new_subscriber: "optional",
  creator_new_member: "optional",
  subscription_renewal: "optional",
  ad_slot_waitlist: "optional",
  new_message: "optional",
  credits_received: "transactional",
  withdrawal_decision: "transactional",
  withdrawal_update: "transactional",
  ai_video_ready: "transactional",
  // Frenz Coin Part 5 (owner, 2026-10-25): a receipt for every coin money movement — deposit, transfer sent / received,
  // withdrawal — to the member it belongs to (lib/coin/notify.ts). Money receipts are never optional.
  coin_transaction: "transactional",
} as const satisfies Record<string, EmailCategory>;
export type MemberEmailKind = keyof typeof MEMBER_EMAIL_KINDS;

/** The senders that don't go through emailMember, for the record (and the classification test). */
export const DIRECT_EMAIL_KINDS = {
  sign_in_code: "security",
  topup_receipt: "transactional",
  ad_campaign_notice: "transactional",
  support_reply: "transactional",
  // 2026-10-23: a code to change your own password (admin dashboard, Account → Password) — never optional
  password_code: "security",
  // Part 4.2: a code to reset your Frenz Coin transaction PIN (app/api/coin/pin/reset) — never optional
  coin_pin_reset: "security",
  // closeout: "your transaction PIN was changed / reset" (lib/coin/notify.ts) — never optional, never the PIN
  coin_pin_security: "security",
  // 2026-10-23: a failed AI job, to the administrators only (lib/ai/failure-alert.ts)
  admin_ai_failure: "transactional",
} as const satisfies Record<string, EmailCategory>;

export const isOptional = (kind: MemberEmailKind): boolean => MEMBER_EMAIL_KINDS[kind] === "optional";

type Db = ReturnType<typeof createAdminClient>;
const PRE_0253 = (m: string) => /optional_email|email_unsubscribe_tokens|column|schema cache|does not exist/i.test(m);

/** Read at SEND time — the latest choice, never one cached from when the message was queued. */
export async function optionalEmailAllowed(userId: string, db: Db = createAdminClient()): Promise<boolean> {
  const { data, error } = await db.from("notification_settings").select("optional_email").eq("user_id", userId).maybeSingle();
  if (error) return PRE_0253(error.message);
  const v = (data as { optional_email?: unknown } | null)?.optional_email;
  return v !== false;
}

/** Many members at once (one bounded read), for a sender that pre-filters a page. Missing = allowed. */
export async function optionalEmailAllowedMany(userIds: readonly string[], db: Db = createAdminClient()): Promise<Set<string> | null> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Set();
  const { data, error } = await db.from("notification_settings").select("user_id, optional_email").in("user_id", ids);
  if (error) return PRE_0253(error.message) ? new Set(ids) : null;
  const off = new Set(((data ?? []) as { user_id: string; optional_email?: unknown }[]).filter((r) => r.optional_email === false).map((r) => r.user_id));
  return new Set(ids.filter((id) => !off.has(id)));
}

function unsubscribeKey(): Buffer | null {
  const own = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (own && own.length >= 32) return Buffer.from(own, "utf8");
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return base ? createHash("sha256").update(`frenz-unsubscribe-key-v1:${base}`, "utf8").digest() : null;
}

export { TOKEN_RE };
export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** The member's token (derived, never stored raw). Null when no key is configured. */
export function unsubscribeTokenFor(userId: string): string | null {
  const key = unsubscribeKey();
  return key ? createHmac("sha256", key).update(`frenz-unsubscribe-v1:${userId}`, "utf8").digest("base64url") : null;
}

/**
 * The URL an optional email carries, after making sure its hash is on file. Null = no link can be
 * offered (no key, or the table isn't there yet) — the email still respects the switch.
 */
export async function unsubscribeUrlFor(userId: string, db: Db = createAdminClient()): Promise<string | null> {
  const token = unsubscribeTokenFor(userId);
  if (!token) return null;
  const { error } = await db.from("email_unsubscribe_tokens").upsert({ token_hash: hashToken(token), user_id: userId }, { onConflict: "user_id" });
  if (error) return null;
  return `${SITE_URL}/api/email/unsubscribe?t=${token}`;
}

export type UnsubscribeResult = { ok: true } | { ok: false; reason: "invalid" | "unavailable" };

/**
 * Turn optional email OFF for the token's member. Idempotent (a second call is the same answer).
 * The answer never says whose link it was, and an unknown token gets the same "invalid" as a
 * malformed one — nothing is learned by trying tokens.
 */
export async function unsubscribeWithToken(token: unknown, db: Db = createAdminClient()): Promise<UnsubscribeResult> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, reason: "invalid" };
  const { data, error } = await db.from("email_unsubscribe_tokens").select("user_id").eq("token_hash", hashToken(token)).maybeSingle();
  if (error) return { ok: false, reason: PRE_0253(error.message) ? "invalid" : "unavailable" };
  const userId = (data as { user_id?: string } | null)?.user_id;
  if (!userId) return { ok: false, reason: "invalid" };
  const w = await db.from("notification_settings").upsert({ user_id: userId, optional_email: false, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return w.error ? { ok: false, reason: "unavailable" } : { ok: true };
}

/** The member's own switch, for Settings. `ready` false = 0253 hasn't run (the switch can't be saved yet). */
export async function getOptionalEmailSetting(userId: string, db: Db = createAdminClient()): Promise<{ on: boolean; ready: boolean }> {
  const { data, error } = await db.from("notification_settings").select("optional_email").eq("user_id", userId).maybeSingle();
  if (error) return { on: true, ready: !PRE_0253(error.message) };
  return { on: (data as { optional_email?: unknown } | null)?.optional_email !== false, ready: true };
}

/** Set the member's OWN switch (the caller passes the session user — never an id from the request). */
export async function setOptionalEmail(userId: string, on: boolean, db: Db = createAdminClient()): Promise<{ ok: boolean; pending?: boolean }> {
  const { error } = await db.from("notification_settings").upsert({ user_id: userId, optional_email: on, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (!error) return { ok: true };
  return PRE_0253(error.message) ? { ok: false, pending: true } : { ok: false };
}
