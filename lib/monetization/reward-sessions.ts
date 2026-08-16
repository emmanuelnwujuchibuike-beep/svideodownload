import "server-only";

import { createHash } from "node:crypto";

import { alreadyCounted, consumeDaily } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedMetadata, getMetadata } from "@/server/extractors";
import type { MediaKind } from "@/types";

import { getUserPlan } from "./plan";
import { getMonetizationSettings } from "./settings";

/**
 * Server-side reward sessions for HD/batch download unlocks (owner, 2026-08-16
 * spec: "secure, production-ready rewarded-ad system", Parts 9-19).
 *
 * ── The one thing this closes ─────────────────────────────────────────────────
 * Before this, `features/monetization/rewarded-ad.tsx` unlocked a download on a
 * purely client-side, self-reported signal (a `<video>` element's own playback
 * clock, or a wall-clock timer) and called `onDownload()` directly — nothing
 * server-side ever knew a reward was claimed. `/api/download` had no way to
 * refuse a forged top-tier `formatId`.
 *
 * A reward session is always "an authorization for a specific list of
 * (url, formatId, kind) items", stored server-side at /start time. HD is simply
 * a list of one. Redemption (`redeemRewardItem`, called from
 * `app/api/download/route.ts`) can only ever return what was stored — never a
 * client-supplied substitute — which is what makes it impossible to earn a
 * reward for one quality/batch and redeem it against another (Parts 12-13).
 *
 * ── What this does NOT and cannot claim ───────────────────────────────────────
 * No ad network wired into this site (Adsterra, Monetag, AdSense) offers a
 * genuine, cryptographically verifiable "the user watched this" event for a
 * plain website — Google's own docs confirm server-side verification for
 * rewarded web ads is an app-only feature. The actual "was an ad shown" signal
 * behind a call to `completeRewardSession` is still the existing client-side ad
 * UI. What's new is that a forged/replayed claim can only ever grant EXACTLY
 * the resource/quality/batch that was requested, at most once per session,
 * within a short window, and counted at most once against the daily limit —
 * not a way to prove the ad was genuinely watched.
 */

export type RewardType = "hd" | "batch";

export interface RewardItemInput {
  url: string;
  formatId: string;
  kind: MediaKind;
  title?: string;
}

export type RewardItem = RewardItemInput;

export type RewardErrorCode =
  | "REWARD_SESSION_EXPIRED"
  | "REWARD_ALREADY_CONSUMED"
  | "REWARD_NOT_GRANTED"
  | "DAILY_LIMIT_REACHED"
  | "USER_NOT_ELIGIBLE"
  | "DOWNLOAD_NOT_FOUND"
  | "DOWNLOAD_TOKEN_EXPIRED"
  | "DOWNLOAD_TOKEN_USED"
  | "BATCH_NOT_FOUND"
  | "QUALITY_NOT_AVAILABLE"
  | "AD_UNAVAILABLE"
  | "FEATURE_DISABLED"
  | "INVALID_REQUEST";

export class RewardError extends Error {
  code: RewardErrorCode;
  constructor(code: RewardErrorCode, message: string) {
    super(message);
    this.name = "RewardError";
    this.code = code;
  }
}

/** Never store a raw IP — same pattern as `app/api/posts/[id]/guest-like/route.ts`. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

const MAX_ITEMS: Record<RewardType, number> = { hd: 1, batch: 50 };

interface SessionRow {
  id: string;
  user_id: string | null;
  ip_hash: string | null;
  type: RewardType;
  status: "pending" | "granted" | "expired";
  payload: { items: RewardItem[] };
  consumed_indexes: number[];
  expires_at: string;
}

async function loadOwnedSession(
  db: ReturnType<typeof createAdminClient>,
  id: string,
  identity: { userId: string | null; ip: string },
): Promise<SessionRow> {
  const { data, error } = await db.from("reward_sessions").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new RewardError("DOWNLOAD_NOT_FOUND", "Reward session not found.");
  const row = data as unknown as SessionRow;

  const owns = identity.userId
    ? row.user_id === identity.userId
    : !!row.ip_hash && row.ip_hash === hashIp(identity.ip);
  if (!owns) throw new RewardError("DOWNLOAD_NOT_FOUND", "Reward session not found.");
  return row;
}

/**
 * Start a reward session: validates the shape, best-effort checks each item's
 * `formatId` genuinely exists for its `url`/`kind` (a metadata-lookup failure
 * fails OPEN here — validation failing closed would mean an extractor hiccup
 * blocks the reward flow entirely; the real security boundary is that
 * redemption can only ever match what's stored, not that this check is
 * airtight), and inserts a `pending` row.
 */
export async function startRewardSession(input: {
  type: RewardType;
  items: RewardItemInput[];
  userId: string | null;
  ip: string;
}): Promise<{ id: string; expiresAt: string }> {
  const settings = await getMonetizationSettings();
  if (input.type === "hd" && !settings.rewardDownloadHdEnabled) {
    throw new RewardError("FEATURE_DISABLED", "HD reward downloads are currently unavailable.");
  }
  if (input.type === "batch" && !settings.rewardDownloadBatchEnabled) {
    throw new RewardError("FEATURE_DISABLED", "Batch reward downloads are currently unavailable.");
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new RewardError("INVALID_REQUEST", "No items requested.");
  }
  const cap = MAX_ITEMS[input.type];
  if (input.items.length > cap) {
    throw new RewardError("INVALID_REQUEST", `Too many items requested (max ${cap}).`);
  }

  const items: RewardItem[] = [];
  for (const raw of input.items) {
    if (!raw.url || !raw.formatId || !raw.kind) {
      throw new RewardError("INVALID_REQUEST", "Each item needs a url, formatId and kind.");
    }
    const item: RewardItem = {
      url: raw.url,
      formatId: raw.formatId,
      kind: raw.kind,
      title: raw.title?.slice(0, 300),
    };
    try {
      const meta = (await getCachedMetadata(item.url)) ?? (await getMetadata(item.url));
      const exists = meta.formats.some((f) => f.formatId === item.formatId && f.kind === item.kind);
      if (!exists) {
        throw new RewardError("QUALITY_NOT_AVAILABLE", "That quality isn't available for this video.");
      }
    } catch (e) {
      if (e instanceof RewardError) throw e;
      // Extraction failed for a reason unrelated to the requested format
      // (source down, timeout, etc.) — don't let that block starting the
      // reward flow; the resource will fail on its own terms at actual
      // download time either way.
    }
    items.push(item);
  }

  const userId = input.userId;
  const ipHash = userId ? null : hashIp(input.ip);

  const db = createAdminClient();
  const { data, error } = await db
    .from("reward_sessions")
    .insert({ user_id: userId, ip_hash: ipHash, type: input.type, payload: { items } })
    .select("id, expires_at")
    .single();
  if (error || !data) throw new RewardError("INVALID_REQUEST", "Couldn't start the reward session.");
  return { id: data.id as string, expiresAt: data.expires_at as string };
}

/**
 * Complete a reward session after the ad UI reports a reward. Idempotent: a
 * replayed completion for an already-`granted` session returns the same items
 * without charging the daily limit twice (Part 14) — `consumeDaily`'s
 * `receiptKey` is the session id, so even a race between two concurrent
 * `/complete` calls charges at most once.
 */
export async function completeRewardSession(input: {
  rewardSessionId: string;
  userId: string | null;
  ip: string;
}): Promise<{ items: RewardItem[] }> {
  const db = createAdminClient();
  const row = await loadOwnedSession(db, input.rewardSessionId, input);

  if (row.status === "granted") return { items: row.payload.items };
  if (row.status !== "pending") {
    throw new RewardError("REWARD_ALREADY_CONSUMED", "This reward has already been used.");
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new RewardError("REWARD_SESSION_EXPIRED", "This reward session expired. Please try again.");
  }

  const plan = await getUserPlan(input.userId);
  if (plan === "free") {
    const settings = await getMonetizationSettings();
    const limit = row.type === "hd" ? settings.rewardHdDailyLimit : settings.rewardBatchDailyLimit;
    const identityKey = input.userId ? `u:${input.userId}` : `ip:${hashIp(input.ip)}`;
    const dailyKey = `reward:${row.type}:${identityKey}`;
    const receiptKey = `reward:${row.type}:${input.rewardSessionId}`;
    if (!(await alreadyCounted(receiptKey))) {
      const result = await consumeDaily(dailyKey, limit, receiptKey);
      if (!result.allowed) {
        throw new RewardError(
          "DAILY_LIMIT_REACHED",
          row.type === "hd" ? "Daily HD download limit reached." : "Daily batch download limit reached.",
        );
      }
    }
  }

  // Bump expiry on grant so the actual transfer(s) have room to retry a
  // network failure without re-earning the reward (Part 19).
  const grantedExpiry = new Date(Date.now() + 30 * 60_000).toISOString();
  await db
    .from("reward_sessions")
    .update({ status: "granted", granted_at: new Date().toISOString(), expires_at: grantedExpiry })
    .eq("id", input.rewardSessionId)
    .eq("status", "pending");

  return { items: row.payload.items };
}

/**
 * Redeem one item from a granted session — called from `/api/download`. The
 * caller MUST use the returned `url`/`formatId`/`kind`/`title` in place of
 * anything the client supplied in its own request; that substitution is the
 * entire security property (Parts 11-13).
 *
 * Re-redeeming an already-touched index within the session's validity window
 * is allowed on purpose — a network failure mid-transfer must not cost a
 * second ad (Part 19). `consumed_indexes` is bookkeeping for that, not a
 * single-use lock.
 */
export async function redeemRewardItem(input: {
  rewardSessionId: string;
  itemIndex: number;
  userId: string | null;
  ip: string;
}): Promise<RewardItem> {
  const db = createAdminClient();
  const row = await loadOwnedSession(db, input.rewardSessionId, input).catch(() => {
    throw new RewardError("DOWNLOAD_TOKEN_EXPIRED", "Download authorization not found.");
  });

  if (row.status !== "granted") {
    throw new RewardError("REWARD_NOT_GRANTED", "This download hasn't been unlocked yet.");
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new RewardError("DOWNLOAD_TOKEN_EXPIRED", "This download authorization expired. Please watch the ad again.");
  }

  const item = row.payload.items[input.itemIndex];
  if (!item) throw new RewardError("BATCH_NOT_FOUND", "That item isn't part of this authorization.");

  if (!row.consumed_indexes?.includes(input.itemIndex)) {
    await db
      .from("reward_sessions")
      .update({ consumed_indexes: [...(row.consumed_indexes ?? []), input.itemIndex] })
      .eq("id", input.rewardSessionId);
  }

  return item;
}
