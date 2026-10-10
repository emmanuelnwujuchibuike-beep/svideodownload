/**
 * THE ad eligibility engine — the one place the serving rules live.
 *
 * There is no getFeedAds / getAIAds / getReelsAds. Every placement on every
 * page goes through `getEligibleAds`, which runs two stages of ONE rule set:
 *
 *   stage 1 — `eligibleForPlacement`  (server, on a CDN miss)
 *     everything that is the same for every visitor: global switch, placement
 *     and format enabled, campaign active + payment verified + advertiser
 *     active, creative valid + destination valid + media type allowed + video
 *     within the CURRENT admin limit, slot order and the slot cap.
 *
 *   stage 2 — `servableNow`  (browser, on the cached payload, no request)
 *     what depends on the moment and the page: the campaign window and the
 *     page targeting. Running it in the browser is what lets a 5-minute CDN
 *     answer stay correct to the second — a campaign that ends at 14:02 stops
 *     at 14:02, not at the next bucket.
 *
 * The SQL (`ad_serving_snapshot`, 0195) only declines to ship rows that could
 * never serve and that hold nothing a visitor should see — it is a privacy
 * filter, not a second copy of these rules.
 *
 * Pure: imported by the serving route AND by the browser.
 */

import { ALL_SLOTS_PLACEMENT, type AdMediaType, type AdPageContext } from "./catalog";
import { checkDestinationUrl } from "./creative-validation";
import { sizedAdImageUrl, slotImageEdge } from "./media-url";

/* ─────────────────────────── the snapshot (from SQL) ─────────────────────────── */

export interface SnapshotFormat {
  code: string;
  media_types: string[];
  width: number | null;
  height: number | null;
  rotation_seconds: number | null;
  slot_count: number | null;
  no_consecutive_repeat: boolean;
  max_duration_seconds: number | null;
  max_file_bytes: number;
  max_width: number;
  max_height: number;
  min_gap_seconds: number;
  enabled: boolean;
}

export interface SnapshotPlacement {
  code: string;
  format_code: string;
  page_scope: string[];
  enabled: boolean;
  priority: number;
}

export interface SnapshotCreative {
  id: string;
  format_code: string;
  media_type: string;
  media_url: string | null;
  thumbnail_url: string | null;
  destination_url: string;
  headline: string | null;
  description: string | null;
  duration_seconds: number | string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  status: string;
  validation_status: string;
  url_validation_status: string;
}

export interface SnapshotCampaign {
  id: string;
  placement_code: string;
  status: string;
  payment_verified: boolean;
  advertiser_status: string;
  advertiser_name: string;
  start_at: string | null;
  end_at: string | null;
  target_pages: string[];
  slot_number: number | null;
  creatives: SnapshotCreative[];
}

export interface ServingSnapshot {
  settings: { ads_enabled: boolean; default_slot_count: number } | null;
  formats: SnapshotFormat[];
  placements: SnapshotPlacement[];
  campaigns: SnapshotCampaign[];
}

/* ─────────────────────────────── the eligible ad ─────────────────────────────── */

/** One entry of a placement's rotation pool — public-safe by construction. */
export interface EligibleAd {
  /** campaign id */
  c: string;
  /** creative id */
  cr: string;
  slot: number | null;
  mediaType: AdMediaType;
  media: string;
  thumb: string | null;
  url: string;
  headline: string | null;
  body: string | null;
  sponsor: string;
  duration: number | null;
  w: number | null;
  h: number | null;
  start: string;
  end: string;
  /** the campaign's own page targeting; empty = the placement's scope */
  pages: string[];
}

export interface FormatRules {
  rotationSeconds: number | null;
  slotCount: number;
  noRepeat: boolean;
  maxDurationSeconds: number | null;
  minGapSeconds: number;
  width: number | null;
  height: number | null;
}

export function formatRules(format: SnapshotFormat, defaultSlotCount: number): FormatRules {
  return {
    rotationSeconds: format.rotation_seconds,
    slotCount: format.slot_count ?? defaultSlotCount,
    noRepeat: format.no_consecutive_repeat,
    maxDurationSeconds: format.max_duration_seconds,
    minGapSeconds: format.min_gap_seconds,
    width: format.width,
    height: format.height,
  };
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

/** Why a creative cannot serve RIGHT NOW under the CURRENT admin config, or null. */
export function creativeServingProblem(cr: SnapshotCreative, format: SnapshotFormat, opts: { anyFormat?: boolean } = {}): string | null {
  if (cr.status !== "active") return "creative_inactive";
  // an All-slots creative is judged by the TARGET slot's rules (media type, length), not by its own format code
  if (!opts.anyFormat && cr.format_code !== format.code) return "format_mismatch";
  if (cr.validation_status !== "valid") return "creative_not_valid";
  if (cr.url_validation_status !== "valid") return "destination_not_valid";
  // belt and braces: a row marked valid that is not even a safe URL never serves
  if (checkDestinationUrl(cr.destination_url).status !== "valid") return "destination_not_valid";
  if (!cr.media_url) return "no_media";
  if (!format.media_types.includes(cr.media_type)) return "media_type_not_allowed";
  if (cr.media_type === "video") {
    const d = num(cr.duration_seconds);
    if (d === null || d <= 0) return "duration_unknown";
    // the CURRENT limit — an admin lowering 20 s to 15 s takes an 18 s video out at once
    if (format.max_duration_seconds !== null && d > format.max_duration_seconds) return "video_too_long";
  }
  return null;
}

/** Why a campaign cannot serve at all (before time and page), or null. */
export function campaignServingProblem(c: SnapshotCampaign): string | null {
  if (c.status !== "active") return "campaign_not_active";
  if (!c.payment_verified) return "payment_unverified";
  if (c.advertiser_status !== "active") return "advertiser_not_active";
  if (!Number.isFinite(time(c.start_at)) || !Number.isFinite(time(c.end_at))) return "no_window";
  return null;
}

/**
 * Stage 1 — the pool for one placement, the same for every visitor.
 * Ordered by slot, then by start; capped at the format's slot count.
 * `notBefore` drops campaigns that ended before it (the serving route passes now).
 */
export function eligibleForPlacement(snapshot: ServingSnapshot, placementCode: string, notBefore: number): EligibleAd[] {
  if (!snapshot.settings?.ads_enabled) return [];
  const placement = snapshot.placements.find((p) => p.code === placementCode);
  if (!placement?.enabled) return [];
  const format = snapshot.formats.find((f) => f.code === placement.format_code);
  if (!format?.enabled) return [];
  const rules = formatRules(format, snapshot.settings.default_slot_count);
  const edge = slotImageEdge(format.width, format.height);

  const out: EligibleAd[] = [];
  const shared: EligibleAd[] = [];
  for (const c of snapshot.campaigns) {
    // 0211: an All-slots campaign joins this slot's rotation when its media fits THIS slot's rules
    const allSlots = c.placement_code === ALL_SLOTS_PLACEMENT && placementCode !== ALL_SLOTS_PLACEMENT;
    if (c.placement_code !== placementCode && !allSlots) continue;
    if (campaignServingProblem(c)) continue;
    if (time(c.end_at) <= notBefore) continue;
    const cr = c.creatives.find((x) => creativeServingProblem(x, format, { anyFormat: allSlots }) === null);
    if (!cr) continue;
    const into = allSlots ? shared : out;
    into.push({
      c: c.id,
      cr: cr.id,
      slot: c.slot_number,
      mediaType: cr.media_type as AdMediaType,
      // images (and a video's poster) resized for the slot — never the upload itself (media-url.ts)
      media: cr.media_type === "image" ? sizedAdImageUrl(cr.media_url, edge)! : cr.media_url!,
      thumb: sizedAdImageUrl(cr.thumbnail_url, edge),
      url: cr.destination_url,
      headline: cr.headline,
      body: cr.description,
      sponsor: c.advertiser_name,
      duration: num(cr.duration_seconds),
      w: cr.width,
      h: cr.height,
      start: c.start_at!,
      end: c.end_at!,
      pages: c.target_pages,
    });
  }
  out.sort((a, b) => (a.slot ?? 1e9) - (b.slot ?? 1e9) || time(a.start) - time(b.start));
  // the slot's own buyers first, then All-slots campaigns (oldest first) — they rotate together
  shared.sort((a, b) => time(a.start) - time(b.start));
  return [...out, ...shared].slice(0, rules.slotCount);
}

/** Does a page match a scope list? `all_pages` matches every page. */
export function pageMatches(scope: readonly string[], page: AdPageContext): boolean {
  return scope.includes("all_pages") || scope.includes(page);
}

/** Stage 2 — is this pool entry servable on this page at this instant? */
export function servableNow(ad: EligibleAd, placementPages: readonly string[], page: AdPageContext, now: number): boolean {
  if (!pageMatches(placementPages, page)) return false;
  if (ad.pages.length > 0 && !pageMatches(ad.pages, page)) return false;
  return time(ad.start) <= now && now < time(ad.end);
}

export interface EligibilityQuery {
  placement: string;
  /** when given, must be the placement's format — a mismatch serves nothing */
  format?: string;
  page: AdPageContext;
  now?: number;
  /** an ad-free member (Pro/Business) is served nothing */
  user?: { adFree?: boolean };
}

/**
 * getEligibleAds — the central function. Both stages, in order.
 * The serving route uses stage 1 to build the payload, the browser runs stage 2
 * on it (`lib/ads-platform/serving-payload.ts`), and tests call this whole.
 */
export function getEligibleAds(snapshot: ServingSnapshot, q: EligibilityQuery): EligibleAd[] {
  if (q.user?.adFree) return [];
  const now = q.now ?? Date.now();
  const placement = snapshot.placements.find((p) => p.code === q.placement);
  if (!placement) return [];
  if (q.format !== undefined && q.format !== placement.format_code) return [];
  return eligibleForPlacement(snapshot, q.placement, now).filter((ad) => servableNow(ad, placement.page_scope, q.page, now));
}
