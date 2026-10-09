/**
 * Creative and destination checks, against the CURRENT admin configuration.
 *
 * The limits are arguments, never constants: the reward-video maximum, the
 * file size, the dimensions all come from the `ad_formats` row the caller
 * read. An admin raising the video limit from 15 s to 20 s makes an 18 s video
 * valid on the next check with no deploy.
 *
 * Three different lengths, never confused (see 0195):
 *   creative `durationSeconds`  ≤ format `maxDurationSeconds`  (here)
 *   campaign `duration_days`     — how long it runs (ad_durations)
 *   format `rotation_seconds`    — how often a banner swaps (rotation.ts)
 *
 * Pure: the browser runs the same checks for instant feedback (Part 2), the
 * server runs them for the verdict that is written to the row.
 */

import type { AdMediaType } from "./catalog";
import { withinUploadCaps } from "./media-spec";

export interface CreativeFacts {
  formatCode: string;
  mediaType: AdMediaType | string;
  mimeType?: string | null;
  durationSeconds?: number | null;
  fileSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  destinationUrl: string | null;
  headline?: string | null;
  description?: string | null;
}

export interface CreativeLimits {
  code: string;
  mediaTypes: readonly string[];
  maxDurationSeconds: number | null;
  maxFileBytes: number;
  maxWidth: number;
  maxHeight: number;
  /** 0196: the smallest acceptable creative, and its shape (width ÷ height) within ± tolerance. Null = no rule. */
  minWidth?: number | null;
  minHeight?: number | null;
  aspectRatio?: number | null;
  aspectTolerance?: number | null;
  /**
   * 0208: a video may be uploaded up to this size when it will be transcoded
   * (videoProcessing) — the served copy is held to maxFileBytes by the transcode.
   */
  maxUploadBytes?: number | null;
  /** 0208: the server can transcode an oversized video (Cloudflare Stream is provisioned) */
  videoProcessing?: boolean;
}

export type CreativeVerdict = { status: "valid"; errors: [] } | { status: "invalid"; errors: string[] };

/** What the ad-creatives buckets accept (0195/0196). The ACCEPT lists the browser offers in its file picker. */
export const IMAGE_MIME_TYPES = ["image/webp", "image/jpeg", "image/png", "image/avif"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;
const IMAGE_MIME = new Set<string>(IMAGE_MIME_TYPES);
const VIDEO_MIME = new Set<string>(VIDEO_MIME_TYPES);

/** Is width ÷ height within the format's shape? True when the format has no shape rule. */
export function aspectFits(width: number, height: number, ratio: number | null | undefined, tolerance: number | null | undefined): boolean {
  if (!ratio || !(width > 0) || !(height > 0)) return true;
  const t = tolerance ?? 0;
  return Math.abs(width / height / ratio - 1) <= t + 1e-9;
}

export function validateCreative(facts: CreativeFacts, limits: CreativeLimits): CreativeVerdict {
  const errors: string[] = [];
  if (facts.formatCode !== limits.code) errors.push("format_mismatch");
  if (facts.mediaType !== "image" && facts.mediaType !== "video") errors.push("media_type_unknown");
  else if (!limits.mediaTypes.includes(facts.mediaType)) errors.push("media_type_not_allowed");
  if (facts.mimeType) {
    const allowed = facts.mediaType === "video" ? VIDEO_MIME : IMAGE_MIME;
    if (!allowed.has(facts.mimeType)) errors.push("mime_not_allowed");
  }
  // a video that will be transcoded may arrive larger than it is served (0208)
  const sizeCap = facts.mediaType === "video" && limits.videoProcessing ? Math.max(limits.maxFileBytes, limits.maxUploadBytes ?? 0) : limits.maxFileBytes;
  if (facts.fileSizeBytes == null || !(facts.fileSizeBytes > 0)) errors.push("size_unknown");
  else if (facts.fileSizeBytes > sizeCap) errors.push("file_too_large");
  if (facts.width == null || facts.height == null || !(facts.width > 0) || !(facts.height > 0)) errors.push("dimensions_unknown");
  else {
    /*
      🔴 0208 (owner, 2026-10-09): a creative is never refused for its SHAPE.
      It is shown whole inside its slot (media-spec FIT_RULE: contain), so a
      landscape image in a portrait slot, or a portrait video in a landscape
      one, is valid. The caps are orientation-agnostic upload limits (a 4K
      landscape video passes a 2160 × 3840 cap); the minimum stays, as a
      quality floor, on the shorter and longer edges.
    */
    if (!withinUploadCaps(facts.width, facts.height, limits.maxWidth, limits.maxHeight)) errors.push("dimensions_too_large");
    const minLong = Math.max(limits.minWidth ?? 0, limits.minHeight ?? 0);
    const minShort = Math.min(limits.minWidth ?? 0, limits.minHeight ?? 0);
    if ((minLong && Math.max(facts.width, facts.height) < minLong) || (minShort && Math.min(facts.width, facts.height) < minShort)) errors.push("dimensions_too_small");
  }
  if (facts.mediaType === "video") {
    const d = facts.durationSeconds;
    if (d == null || !(d > 0)) errors.push("duration_unknown");
    else if (limits.maxDurationSeconds !== null && d > limits.maxDurationSeconds) errors.push("video_too_long");
  }
  if (facts.headline && facts.headline.length > 90) errors.push("headline_too_long");
  if (facts.description && facts.description.length > 240) errors.push("description_too_long");
  // the destination is checked only once it is known - a creative is uploaded before its link is typed
  if (facts.destinationUrl !== null && checkDestinationUrl(facts.destinationUrl).status !== "valid") errors.push("destination_not_valid");
  return errors.length ? { status: "invalid", errors } : { status: "valid", errors: [] };
}

export type UrlVerdict = { status: "valid" } | { status: "blocked"; reason: string };

/**
 * The SYNTACTIC destination check: what can be refused without asking anyone.
 * Part 2 adds the reputation check (a safe-browsing lookup, redirect chasing);
 * until then nothing reaches `valid` that is not at least a well-formed public
 * https address. Never throws.
 */
export function checkDestinationUrl(raw: string | null | undefined): UrlVerdict {
  if (typeof raw !== "string") return { status: "blocked", reason: "missing" };
  const s = raw.trim();
  if (s.length < 8 || s.length > 2048) return { status: "blocked", reason: "length" };
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return { status: "blocked", reason: "whitespace_or_control" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { status: "blocked", reason: "not_a_url" };
  }
  if (u.protocol !== "https:") return { status: "blocked", reason: "not_https" };
  if (u.username || u.password) return { status: "blocked", reason: "credentials_in_url" };
  if (u.port && u.port !== "443") return { status: "blocked", reason: "non_standard_port" };
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".")) return { status: "blocked", reason: "no_public_host" };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return { status: "blocked", reason: "ip_address" };
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|test|invalid|example)$/.test(host)) {
    return { status: "blocked", reason: "private_host" };
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    return { status: "blocked", reason: "bad_host" };
  }
  if (!/^[a-z]{2,63}$|^xn--[a-z0-9-]{1,59}$/.test(host.split(".").pop()!)) return { status: "blocked", reason: "bad_tld" };
  return { status: "valid" };
}
