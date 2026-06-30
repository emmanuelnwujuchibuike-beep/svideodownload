/**
 * Frenzsave SDK — shared wire types.
 *
 * IMPORTANT: this folder is the cross-platform client contract. It must stay
 * dependency-free and framework-free (no React, no Next, no `@/` imports) so the
 * exact same code powers web, iOS, Android and desktop. It can be lifted into a
 * published npm package (`@frenzsave/sdk`) with no changes. See docs/API.md.
 */

/** Stable error codes — mirrors `ErrorCode` in lib/api/respond.ts. */
export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_failed"
  | "rate_limited"
  | "quota_exceeded"
  | "upstream_error"
  | "unavailable"
  | "internal"
  | "network" // client-side: request never reached the server
  | "timeout"; // client-side: request exceeded the timeout

export interface ResponseMeta {
  nextCursor?: string | null;
  requestId?: string;
}

export type ApiEnvelope<T> =
  | { ok: true; data: T; meta?: ResponseMeta }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export type BillingPlan = "free" | "pro" | "business";

export interface MeResponse {
  authenticated: boolean;
  userId: string | null;
  handle: string | null;
  profile: { displayName: string | null; avatarUrl: string | null; isVerified: boolean } | null;
  plan: BillingPlan;
  isPremium: boolean;
  isBusiness: boolean;
  showAds: boolean;
  limits: { dailyDownloads: number; batch: number; apiDailyLimit: number };
}

export type MediaKind = "video" | "audio" | "image";
export type FeedSort = "for_you" | "following" | "recent";

export interface FeedPublisher {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  plan: BillingPlan;
}

export interface FeedItem {
  id: string;
  title: string;
  description: string | null;
  platform: string;
  mediaKind: MediaKind;
  thumbnailUrl: string | null;
  sourceUrl: string;
  mediaUrl: string | null;
  category: string | null;
  durationSec: number | null;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  downloadsCount: number;
  createdAt: string;
  publisher: FeedPublisher;
  viewerLiked: boolean;
  viewerSaved: boolean;
  isFollowing: boolean;
  isOwner: boolean;
}

export interface FeedResponse {
  items: FeedItem[];
  sort: FeedSort;
}

/** A page plus the cursor to fetch the next one (null when exhausted). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
