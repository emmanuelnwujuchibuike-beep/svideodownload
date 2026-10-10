/**
 * The advertiser's menu — what may be BOUGHT right now — from `ad_catalog()`
 * (0196). Every option the application shows comes through here, so the rule
 * "only admin-enabled, priced options may be purchased" lives in one place:
 *
 *   a format is offered       when it is enabled AND has a placement that is offered
 *   a placement is offered    when it is enabled, of that format, AND has a price
 *                             for an enabled duration in the display currency
 *   a duration is offered     when it is enabled AND priced for EVERY chosen placement
 *   a promotion applies       when the database says it is live, it has not
 *                             ended since (checked again here, to the second), and
 *                             it matches the placement and duration
 *
 * The price shown is an ESTIMATE that follows `ad_campaign_quote` (0195) rule
 * for rule — best discount, then most extra days, then oldest; the discount
 * rounded DOWN. The amount the advertiser pays is locked by the database at
 * submission, never taken from here.
 *
 * Pure: the browser and the server both use it.
 */

import { SPEC_DEFAULTS, uploadBytesOf } from "./media-spec";

export type Currency = "CREDIT" | "USD" | "NGN";

export interface CatalogFormat {
  code: string;
  name: string;
  description: string | null;
  recommendation: string | null;
  media_types: string[];
  width: number | null;
  height: number | null;
  rotation_seconds: number | null;
  max_duration_seconds: number | null;
  max_file_bytes: number;
  max_width: number;
  max_height: number;
  min_width: number | null;
  min_height: number | null;
  aspect_ratio: number | null;
  aspect_tolerance: number;
  /** 0208 — defaulted by parseCatalog until the migration has run (media-spec SPEC_DEFAULTS) */
  delivery_long_edge: number;
  image_quality: number;
  max_upload_bytes: number | null;
}

export interface CatalogPlacement {
  code: string;
  name: string;
  description: string | null;
  format_code: string;
  page_scope: string[];
}

export interface CatalogDuration {
  id: string;
  name: string;
  days: number;
}

export interface CatalogPrice {
  placement_code: string;
  duration_id: string;
  currency: Currency;
  price_minor: number;
}

export interface CatalogPromotion {
  id: string;
  name: string;
  description: string | null;
  placement_code: string | null;
  duration_id: string | null;
  extra_days: number;
  discount_percent: number;
  ends_at: string | null;
  created_at: string;
}

export interface AdCatalog {
  v: 1;
  settings: {
    ads_enabled: boolean;
    applications_open: boolean;
    multi_placement_enabled: boolean;
    max_placements_per_application: number;
    display_currency: Currency;
    default_slot_count: number;
  };
  formats: CatalogFormat[];
  placements: CatalogPlacement[];
  durations: CatalogDuration[];
  prices: CatalogPrice[];
  promotions: CatalogPromotion[];
  /** the database clock when this was read */
  at: string;
}

const n = (v: unknown): number => (typeof v === "number" ? v : Number(v));

/** Validate and normalise (numerics arrive as strings from Postgres). Malformed ⇒ null ⇒ nothing is for sale. */
export function parseCatalog(raw: unknown): AdCatalog | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = r.settings as AdCatalog["settings"] | null;
  if (r.v !== 1 || !s || typeof s !== "object") return null;
  for (const k of ["formats", "placements", "durations", "prices", "promotions"]) if (!Array.isArray(r[k])) return null;
  return {
    v: 1,
    settings: { ...s, max_placements_per_application: n(s.max_placements_per_application), default_slot_count: n(s.default_slot_count) },
    formats: (r.formats as CatalogFormat[]).map((f) => ({
      ...f,
      max_file_bytes: n(f.max_file_bytes),
      aspect_ratio: f.aspect_ratio === null ? null : n(f.aspect_ratio),
      aspect_tolerance: n(f.aspect_tolerance ?? 0),
      delivery_long_edge: f.delivery_long_edge == null ? SPEC_DEFAULTS.deliveryLongEdge : n(f.delivery_long_edge),
      image_quality: f.image_quality == null ? SPEC_DEFAULTS.imageQuality : n(f.image_quality),
      max_upload_bytes: uploadBytesOf(f),
    })),
    placements: r.placements as CatalogPlacement[],
    durations: (r.durations as CatalogDuration[]).map((d) => ({ ...d, days: n(d.days) })),
    prices: (r.prices as CatalogPrice[]).map((p) => ({ ...p, price_minor: n(p.price_minor) })),
    promotions: (r.promotions as CatalogPromotion[]).map((p) => ({ ...p, extra_days: n(p.extra_days), discount_percent: n(p.discount_percent) })),
    at: String(r.at ?? ""),
  };
}

export function priceFor(cat: AdCatalog, placementCode: string, durationId: string): number | null {
  const p = cat.prices.find((x) => x.placement_code === placementCode && x.duration_id === durationId && x.currency === cat.settings.display_currency);
  return p ? p.price_minor : null;
}

export function offeredPlacements(cat: AdCatalog, formatCode: string): CatalogPlacement[] {
  return cat.placements.filter((p) => p.format_code === formatCode && cat.durations.some((d) => priceFor(cat, p.code, d.id) !== null));
}

export function offeredFormats(cat: AdCatalog): CatalogFormat[] {
  return cat.formats.filter((f) => offeredPlacements(cat, f.code).length > 0);
}

/** Durations priced for EVERY chosen placement. */
export function offeredDurations(cat: AdCatalog, placementCodes: readonly string[]): CatalogDuration[] {
  if (placementCodes.length === 0) return [];
  return cat.durations.filter((d) => placementCodes.every((p) => priceFor(cat, p, d.id) !== null));
}

/** How many placements one application may take: 1 unless the admin turned multiple on. */
export function maxPlacements(cat: AdCatalog): number {
  return cat.settings.multi_placement_enabled ? Math.max(1, cat.settings.max_placements_per_application) : 1;
}

/** The promotion `ad_campaign_quote` would apply — same filter, same order. */
export function bestPromotion(cat: AdCatalog, placementCode: string, durationId: string, now: number = Date.now()): CatalogPromotion | null {
  const live = cat.promotions.filter(
    (p) =>
      (p.placement_code === null || p.placement_code === placementCode) &&
      (p.duration_id === null || p.duration_id === durationId) &&
      (p.ends_at === null || Date.parse(p.ends_at) > now),
  );
  live.sort((a, b) => b.discount_percent - a.discount_percent || b.extra_days - a.extra_days || Date.parse(a.created_at) - Date.parse(b.created_at));
  return live[0] ?? null;
}

export interface QuoteLine {
  placementCode: string;
  list: number;
  discountPercent: number;
  discount: number;
  total: number;
  days: number;
  extraDays: number;
  promotion: CatalogPromotion | null;
}

export interface Estimate {
  currency: Currency;
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  total: number;
}

/** The display estimate for an application. Null when any part is no longer for sale. */
export function estimate(cat: AdCatalog, placementCodes: readonly string[], durationId: string, now: number = Date.now()): Estimate | null {
  const duration = cat.durations.find((d) => d.id === durationId);
  if (!duration || placementCodes.length === 0) return null;
  const lines: QuoteLine[] = [];
  for (const code of placementCodes) {
    const list = priceFor(cat, code, durationId);
    if (list === null) return null;
    const promo = bestPromotion(cat, code, durationId, now);
    const pct = promo?.discount_percent ?? 0;
    const discount = Math.floor((list * pct) / 100);
    lines.push({ placementCode: code, list, discountPercent: pct, discount, total: Math.max(0, list - discount), days: duration.days, extraDays: promo?.extra_days ?? 0, promotion: promo });
  }
  const subtotal = lines.reduce((s, l) => s + l.list, 0);
  const total = lines.reduce((s, l) => s + l.total, 0);
  return { currency: cat.settings.display_currency, lines, subtotal, discount: subtotal - total, total };
}

/** The lowest price of a format, for "from $X". */
export function fromPrice(cat: AdCatalog, formatCode: string): number | null {
  const codes = new Set(offeredPlacements(cat, formatCode).map((p) => p.code));
  const prices = cat.prices.filter((p) => codes.has(p.placement_code) && p.currency === cat.settings.display_currency && cat.durations.some((d) => d.id === p.duration_id));
  return prices.length ? Math.min(...prices.map((p) => p.price_minor)) : null;
}

/** `price_minor` in the advertiser's terms: USD cents → $12.50, NGN kobo → ₦1,250, credits → 120 credits. */
export function formatMoney(minor: number, currency: Currency): string {
  if (currency === "CREDIT") return `${minor.toLocaleString("en-US")} ${minor === 1 ? "credit" : "credits"}`;
  const major = minor / 100;
  const symbol = currency === "USD" ? "$" : "₦";
  const whole = Number.isInteger(major);
  return `${symbol}${major.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The specification lines of a format, from its CURRENT row. */
export function formatSpecs(f: CatalogFormat): string[] {
  const out: string[] = [];
  if (f.width && f.height) out.push(`${f.width} × ${f.height}`);
  else if (f.height) out.push(`Image ${STRIP_IMAGE_HEIGHT.min}–${STRIP_IMAGE_HEIGHT.max} px tall, fitted to every screen`);
  else out.push("Full-screen");
  out.push(f.media_types.length === 2 ? "Image or video" : f.media_types[0] === "video" ? "Video" : "Image");
  if (f.media_types.includes("video") && f.max_duration_seconds) out.push(`Video up to ${f.max_duration_seconds} s`);
  out.push(`Up to ${formatBytes(f.max_file_bytes)}`);
  if (f.rotation_seconds) out.push(`Rotates every ${f.rotation_seconds} s`);
  // 0205 (owner, 2026-10-09): formats without a timer change on every show (every download, every break)
  else out.push("A new ad each time it shows");
  return out;
}

/**
 * The thin strip under the header (a height, no width) — owner, 2026-10-10:
 * "let users be told to only use an image of 32 to 40px height, and width will
 * be compressed by us on all screen sizes. No description, because of the
 * size: the description comes from the image." The strip shows the image and
 * nothing else, so the words must be IN the image.
 */
export const STRIP_IMAGE_HEIGHT = { min: 32, max: 40 } as const;

export function isStripFormat(f: Pick<CatalogFormat, "width" | "height">): boolean {
  return !f.width && !!f.height;
}

export const STRIP_GUIDANCE = `Use an image ${STRIP_IMAGE_HEIGHT.min}–${STRIP_IMAGE_HEIGHT.max} px tall, any width — we fit it to every screen size. There is no description on this banner, so put your message in the image itself.`;

/** The recommended creative size from the format's shape and minimum. */
export function recommendedSize(f: CatalogFormat): string | null {
  if (isStripFormat(f)) return `an image ${STRIP_IMAGE_HEIGHT.min}–${STRIP_IMAGE_HEIGHT.max} px tall, any width`;
  if (!f.min_width || !f.min_height) return null;
  return `at least ${f.min_width} × ${f.min_height}`;
}
