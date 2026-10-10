/**
 * Friend Requests™ — the Adaptive Trust Workflow (Feature 19 · Part 2).
 *
 * Pure rules, no I/O: who may send a request, how many a sender may send, and
 * whether a note reads like spam. lib/social/friends.ts gathers the facts and
 * asks these functions; the tests here are the specification.
 *
 * ── Why these inputs and no others ─────────────────────────────────────────
 * Every signal is something the platform already holds about the SENDER's own
 * behaviour: account age, verification, how many friends they have, and what
 * happened to the requests they sent. Nothing reads the receiver's activity,
 * and nothing is a "score" anyone sees — a sender who is limited is told so in
 * plain words, never given a number to game.
 */

/** Who may send you a friend request (privacy_settings.friend_requests_policy, 0216). */
export const REQUEST_POLICIES = ["everyone", "friends_of_friends", "verified", "nobody"] as const;
export type RequestPolicy = (typeof REQUEST_POLICIES)[number];

export const REQUEST_POLICY_LABELS: Record<RequestPolicy, string> = {
  everyone: "Everyone",
  friends_of_friends: "Friends of friends",
  verified: "Verified accounts",
  nobody: "Nobody",
};

export function isRequestPolicy(v: unknown): v is RequestPolicy {
  return typeof v === "string" && (REQUEST_POLICIES as readonly string[]).includes(v);
}

/** May this sender ask, under the receiver's policy? An unknown policy reads as the default. */
export function policyAllows(policy: string | null | undefined, sender: { mutualFriends: number; verified: boolean }): boolean {
  const p: RequestPolicy = isRequestPolicy(policy) ? policy : "everyone";
  if (p === "everyone") return true;
  if (p === "nobody") return false;
  if (p === "verified") return sender.verified;
  return sender.mutualFriends > 0;
}

/* ───────────────────────────── adaptive limits ───────────────────────────── */

export interface SenderFacts {
  accountAgeDays: number;
  verified: boolean;
  friends: number;
  /** requests this sender created in the last 24 h / last hour */
  sentLastDay: number;
  sentLastHour: number;
  /** of the requests sent in the last 7 days: how many, and how many were declined or ignored */
  sentLastWeek: number;
  refusedLastWeek: number;
}

/** A new account (under a week) — the window bots and throwaways live in. */
export const NEW_ACCOUNT_DAYS = 7;
/** An established member: three months old and an actual friend circle. */
export const ESTABLISHED_DAYS = 90;
export const ESTABLISHED_FRIENDS = 10;
export const DAILY_NEW = 10;
export const DAILY_STANDARD = 20;
export const DAILY_TRUSTED = 40;
/** No one sends more than this in an hour — a burst is automation or a mass invite either way. */
export const HOURLY_BURST = 10;
/** Most of last week's requests refused: the allowance halves. Nearly all: a 24 h pause. */
export const REFUSAL_MIN_SAMPLE = 10;
export const REFUSAL_HALVE = 0.6;
export const REFUSAL_PAUSE = 0.85;

export type Allowance =
  | { ok: true; dailyCap: number; tier: "new" | "standard" | "trusted"; reduced: boolean }
  | { ok: false; reason: "hourly" | "daily" | "paused"; dailyCap: number };

export function requestAllowance(f: SenderFacts): Allowance {
  const tier: "new" | "standard" | "trusted" =
    f.accountAgeDays < NEW_ACCOUNT_DAYS && !f.verified
      ? "new"
      : f.verified || (f.accountAgeDays >= ESTABLISHED_DAYS && f.friends >= ESTABLISHED_FRIENDS)
        ? "trusted"
        : "standard";
  let cap = tier === "new" ? DAILY_NEW : tier === "trusted" ? DAILY_TRUSTED : DAILY_STANDARD;
  const ratio = f.sentLastWeek >= REFUSAL_MIN_SAMPLE ? f.refusedLastWeek / f.sentLastWeek : 0;
  if (ratio >= REFUSAL_PAUSE) return { ok: false, reason: "paused", dailyCap: 0 };
  const reduced = ratio >= REFUSAL_HALVE;
  if (reduced) cap = Math.max(1, Math.floor(cap / 2));
  if (f.sentLastHour >= HOURLY_BURST) return { ok: false, reason: "hourly", dailyCap: cap };
  if (f.sentLastDay >= cap) return { ok: false, reason: "daily", dailyCap: cap };
  return { ok: true, dailyCap: cap, tier, reduced };
}

/* ───────────────────────────── request lifecycle ─────────────────────────── */

/** A request no one answered stops asking after this long (status "expired"). */
export const REQUEST_EXPIRES_DAYS = 30;
/** After a decline, the same sender may not ask the same person again for this long. */
export const DECLINE_COOLDOWN_DAYS = 30;

/** Where a request was sent from (friend_requests.source, 0216) — for the receiver's context and the spam review. */
export const REQUEST_SOURCES = ["profile", "search", "suggestion", "qr", "nearby", "link", "messages", "other"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];
export function isRequestSource(v: unknown): v is RequestSource {
  return typeof v === "string" && (REQUEST_SOURCES as readonly string[]).includes(v);
}

/* ───────────────────────────── the invitation note ───────────────────────── */

export const NOTE_MAX = 150;
/** The same note to this many different people in a day is a mass invitation. */
export const NOTE_REPEAT_LIMIT = 5;

export type NoteProblem = "link" | "contact" | "repeated" | null;

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ng|co|me|xyz|link|info|biz|app|site|online|shop|top|click)\b)/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// 8+ digits allowing spaces, dots and dashes between them — a phone number, not "see you at 7"
const PHONE = /(?:\+?\d[\s.-]?){8,}/;
const MESSENGER = /\b(whats\s?app|telegram|t\.me|wa\.me|signal|snap(chat)?|dm me on)\b/i;

/**
 * Why a note may not be sent, or null. A note is for "we met at the event", not
 * for moving someone off the platform: links and contact details are the shape
 * of almost every scam invitation, so they are refused outright, and the same
 * text to many people in a day is a mass invitation.
 */
export function noteProblem(note: string | null | undefined, sameNoteSentToday: number): NoteProblem {
  const n = (note ?? "").trim();
  if (!n) return null;
  // an email has a domain in it — contact details first, so it is named for what it is
  if (EMAIL.test(n) || PHONE.test(n) || MESSENGER.test(n)) return "contact";
  if (LINK.test(n)) return "link";
  if (sameNoteSentToday >= NOTE_REPEAT_LIMIT) return "repeated";
  return null;
}

/** Notes compared for "the same text": case, spacing and punctuation do not make a copy-paste different. */
export function noteFingerprint(note: string): string {
  return note
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
