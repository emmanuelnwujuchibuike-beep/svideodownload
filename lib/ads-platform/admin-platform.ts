import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { recordConfigChange } from "@/lib/platform/config-audit";

import { AD_ADVERTISER_CONTROLS_KEY, loadControls, parseControls, type AdvertiserControls } from "./campaign-manage";

/**
 * Part 7 — the platform levers, over tables Parts 1-6 already made:
 *
 *   ad_platform_settings      the kill switch, applications, payments, slot
 *                             count, quote lifetime, refund/chargeback policy
 *   settings.ad_advertiser_controls   what an advertiser may change on a paid campaign
 *   ad_blocked_domains        links an ad may never point to
 *   ad_pricing_plans          one price per placement × length × currency
 *   ad_promotions             database-applied discounts and bonus days
 *
 * The database's own checks are the last word (ranges, currencies, windows);
 * the schemas here only turn a bad request into a clear 400 first. Campaign
 * lengths keep their own panel (/api/admin/ads/durations).
 */

type Db = SupabaseClient;

export const platformSettingsSchema = z
  .object({
    ads_enabled: z.boolean(),
    applications_open: z.boolean(),
    payments_enabled: z.boolean(),
    default_slot_count: z.number().int().min(1).max(50),
    quote_ttl_minutes: z.number().int().min(5).max(1440),
    checkout_honour_hours: z.number().int().min(1).max(168),
    refund_after_start: z.enum(["remove", "pause", "keep"]),
    chargeback_action: z.enum(["pause", "remove"]),
  })
  .partial()
  .strict();
export type PlatformSettingsPatch = z.infer<typeof platformSettingsSchema>;

const SETTINGS_COLUMNS = "ads_enabled, applications_open, payments_enabled, default_slot_count, quote_ttl_minutes, checkout_honour_hours, refund_after_start, chargeback_action, updated_at";

export const controlsSchema = z
  .object({ replaceCreative: z.boolean(), editText: z.boolean(), editDestination: z.boolean(), pauseResume: z.boolean(), extensions: z.boolean() })
  .partial()
  .strict();

/** A bare host: lowercase, at least one dot, no scheme or path (the table's own check agrees). */
export function normalizeBlockedDomain(raw: string): string | null {
  let v = raw.trim().toLowerCase();
  v = v.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  v = v.split(/[/?#:]/)[0] ?? "";
  return /^[a-z0-9.-]+[.][a-z0-9-]+$/.test(v) && !v.startsWith(".") && !v.includes("..") ? v : null;
}

export interface PlatformState {
  settings: Record<string, unknown> | null;
  controls: AdvertiserControls;
  blocked: { domain: string; reason: string; createdAt: string }[];
  /** 0208: every creative format's media limits, for the admin to tune */
  formats: Record<string, unknown>[];
  /** 0240: views-based pricing (null until the migration runs) */
  views: ViewsAdmin | null;
}

/*
  ── CREATIVE FORMATS (0208, owner 2026-10-09: "Allow authorized admins to
  configure recommended dimensions, maximum dimensions, file-size limits, video
  duration, output quality, and supported formats") ──
  The bounds mirror the database's own checks (0195/0196/0208), so a value the
  database would refuse is refused here first with a clear message. A change
  applies to the NEXT upload and the next check — creatives already live are
  never re-judged by it (validateCampaignCreatives runs only when asked).
*/
const MB = 1024 * 1024;
export const formatPatchSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
    width: z.number().int().min(1).max(10000).nullable(),
    height: z.number().int().min(1).max(10000).nullable(),
    max_width: z.number().int().min(16).max(8192),
    max_height: z.number().int().min(16).max(8192),
    min_width: z.number().int().min(1).max(8192).nullable(),
    min_height: z.number().int().min(1).max(8192).nullable(),
    max_file_bytes: z.number().int().min(1024).max(200 * MB),
    max_upload_bytes: z.number().int().min(1024).max(2048 * MB).nullable(),
    delivery_long_edge: z.number().int().min(240).max(3840),
    image_quality: z.number().int().min(40).max(100),
    max_duration_seconds: z.number().int().min(1).max(600).nullable(),
    media_types: z.array(z.enum(["image", "video"])).min(1).max(2),
  })
  .partial()
  .required({ code: true })
  .strict();

export async function loadFormats(db: Db): Promise<Record<string, unknown>[]> {
  // "*": the 0208 columns appear when the migration has run; the admin sees what exists
  const { data, error } = await db.from("ad_formats").select("*").order("sort_order", { ascending: true });
  if (error) throw new Error(`ad formats: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

export async function saveFormat(db: Db, patch: z.infer<typeof formatPatchSchema>): Promise<Record<string, unknown>> {
  const { code, ...fields } = patch;
  if (fields.media_types) fields.media_types = [...new Set(fields.media_types)];
  if (fields.min_width != null && fields.max_width != null && fields.min_width > fields.max_width) throw new AdminFormatError("The minimum width is above the maximum.");
  if (fields.min_height != null && fields.max_height != null && fields.min_height > fields.max_height) throw new AdminFormatError("The minimum height is above the maximum.");
  const { data, error } = await db.from("ad_formats").update({ ...fields, updated_at: new Date().toISOString() }).eq("code", code).select("*").maybeSingle();
  if (error) throw new AdminFormatError(error.message.includes("column") ? "This setting needs migration 0208 — run it, then save again." : "The database refused that value.");
  if (!data) throw new AdminFormatError("No such format.");
  return data as Record<string, unknown>;
}

export class AdminFormatError extends Error {}

/*
  ── VIEWS-BASED PRICING (0240, owner 2026-10-12: "minimum applicable per views
  should be able to be set by admin") ──
  The rate per 1,000 views, the minimum / maximum / step of a target, the free
  extension rule and the capacity policy are all columns: a change applies to
  the NEXT quote, never to a campaign already priced (its snapshot holds the
  terms it was sold on). Read on its own so the panel still loads before 0240.
*/
const VIEWS_COLUMNS_0240 =
  "views_enabled, views_rate_per_1000_minor, views_min_target, views_max_target, views_target_step, views_auto_extend, views_extension_days, views_max_extensions, views_capacity_policy, views_capacity_window_days";
/** 0242 adds fixed-period on/off, the minimum checkout, tiers and the delivery policies */
const VIEWS_COLUMNS_0242 = `${VIEWS_COLUMNS_0240}, fixed_enabled, views_min_checkout_minor, views_volume_tiers, views_extend_when_advertiser_paused, views_suspension_policy, views_on_exhausted, views_review_after_extensions`;

/** Volume tiers: up to 10, whole positive numbers, thresholds strictly rising and rates never rising with volume. */
export const volumeTiersSchema = z
  .array(z.object({ min_views: z.number().int().min(1).max(100_000_000), rate_per_1000_minor: z.number().int().min(1).max(10_000_000) }).strict())
  .max(10)
  .superRefine((tiers, ctx) => {
    const sorted = [...tiers].sort((a, b) => a.min_views - b.min_views);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.min_views === sorted[i - 1]!.min_views) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Two tiers start at the same number of views." });
      if (sorted[i]!.rate_per_1000_minor > sorted[i - 1]!.rate_per_1000_minor) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A bigger tier can't cost more per 1,000 views." });
    }
  });

/**
 * 0246 volume discounts (owner, 2026-10-15: "discount from 5% to 30% … 1m views 30%, 500K 25%"):
 * up to 10 steps, a whole percentage 0–90, thresholds distinct and a bigger step never a smaller discount.
 */
export const volumeDiscountsSchema = z
  .array(z.object({ min_views: z.number().int().min(1).max(100_000_000), percent: z.number().int().min(0).max(90) }).strict())
  .max(10)
  .superRefine((steps, ctx) => {
    const sorted = [...steps].sort((a, b) => a.min_views - b.min_views);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.min_views === sorted[i - 1]!.min_views) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Two discounts start at the same number of views." });
      if (sorted[i]!.percent < sorted[i - 1]!.percent) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "More views can't get a smaller discount." });
    }
  });

export const viewsSettingsSchema = z
  .object({
    views_enabled: z.boolean(),
    views_rate_per_1000_minor: z.number().int().min(1).max(10_000_000),
    views_min_target: z.number().int().min(1).max(100_000_000),
    views_max_target: z.number().int().min(1).max(100_000_000),
    views_target_step: z.number().int().min(1).max(1_000_000),
    views_auto_extend: z.boolean(),
    views_extension_days: z.number().int().min(1).max(90),
    views_max_extensions: z.number().int().min(0).max(52),
    views_capacity_policy: z.enum(["allow", "review", "block"]),
    views_capacity_window_days: z.number().int().min(1).max(90),
    /* 0242 */
    fixed_enabled: z.boolean(),
    views_min_checkout_minor: z.number().int().min(0).max(100_000_000),
    views_volume_tiers: volumeTiersSchema,
    views_extend_when_advertiser_paused: z.boolean(),
    views_suspension_policy: z.enum(["close_refund", "hold_review"]),
    views_on_exhausted: z.enum(["review", "close_refund"]),
    views_review_after_extensions: z.number().int().min(0).max(52),
    /* 0246 */
    views_volume_discounts: volumeDiscountsSchema,
  })
  .partial()
  .strict();

export const viewsPatchSchema = z
  .object({
    settings: viewsSettingsSchema.optional(),
    /** a placement's own rate (null = the default) and whether it sells views */
    placement: z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), views_enabled: z.boolean().optional(), views_rate_per_1000_minor: z.number().int().min(1).max(10_000_000).nullable().optional() }).strict().optional(),
    /** whether a campaign period may be chosen for a views campaign */
    duration: z.object({ id: z.string().uuid(), views_enabled: z.boolean() }).strict().optional(),
    /** 0242: a new campaign period (for new purchases; running campaigns keep theirs) */
    newDuration: z.object({ days: z.number().int().min(1).max(366), name: z.string().trim().min(1).max(40) }).strict().optional(),
  })
  .strict();

export interface ViewsAdmin {
  settings: Record<string, unknown>;
  placements: { code: string; name: string; views_enabled: boolean; views_rate_per_1000_minor: number | null }[];
  durations: { id: string; name: string; duration_days: number; enabled: boolean; views_enabled: boolean }[];
  /** false until 0242 runs: its controls are shown as waiting for the migration */
  migrated0242: boolean;
  /** false until 0246 runs: the discount table waits for it */
  migrated0246: boolean;
}

/** null before 0240 runs: the panel says so instead of failing. */
export async function loadViewsAdmin(db: Db): Promise<ViewsAdmin | null> {
  const [s2, pl, du, d46] = await Promise.all([
    db.from("ad_platform_settings").select(VIEWS_COLUMNS_0242).eq("id", true).maybeSingle(),
    db.from("ad_placements").select("code, name, views_enabled, views_rate_per_1000_minor").order("sort_order", { ascending: true }),
    db.from("ad_durations").select("id, name, duration_days, enabled, views_enabled").order("duration_days", { ascending: true }),
    // 0246, on its own so the panel loads before it runs
    db.from("ad_platform_settings").select("views_volume_discounts").eq("id", true).maybeSingle(),
  ]);
  const s = s2.error ? await db.from("ad_platform_settings").select(VIEWS_COLUMNS_0240).eq("id", true).maybeSingle() : s2;
  if (s.error || pl.error || du.error || !s.data) return null;
  return {
    settings: { ...(s.data as Record<string, unknown>), ...(d46.error || !d46.data ? {} : (d46.data as Record<string, unknown>)) },
    placements: (pl.data ?? []) as ViewsAdmin["placements"],
    durations: (du.data ?? []) as ViewsAdmin["durations"],
    migrated0242: !s2.error,
    migrated0246: !d46.error && !!d46.data,
  };
}

/**
 * Save one change and record it in config_audit_log (who, before, after, when) —
 * the repo's existing settings audit trail. A change applies to the NEXT quote:
 * a priced campaign keeps the terms in its snapshot.
 */
export async function saveViews(db: Db, adminId: string, patch: z.infer<typeof viewsPatchSchema>): Promise<ViewsAdmin | null> {
  const now = new Date().toISOString();
  const cur = await loadViewsAdmin(db);
  if (!cur) throw new AdminFormatError("Views pricing needs migration 0240 — run it, then save again.");
  if (patch.settings && Object.keys(patch.settings).length) {
    const s = patch.settings;
    if (!cur.migrated0246 && "views_volume_discounts" in s) throw new AdminFormatError("Volume discounts need migration 0246 — run it, then save again.");
    if (!cur.migrated0242 && Object.keys(s).some((k) => k !== "views_volume_discounts" && !VIEWS_COLUMNS_0240.includes(k))) throw new AdminFormatError("This setting needs migration 0242 — run it, then save again.");
    const next = { ...cur.settings, ...s } as { views_min_target: number; views_max_target: number; views_enabled?: boolean; fixed_enabled?: boolean };
    if (next.views_min_target > next.views_max_target) throw new AdminFormatError("The minimum views are above the maximum.");
    if (next.fixed_enabled === false && next.views_enabled === false) throw new AdminFormatError("At least one way to buy must stay on sale.");
    const { error } = await db.from("ad_platform_settings").update({ ...s, updated_by: adminId, updated_at: now }).eq("id", true);
    if (error) throw new AdminFormatError("The database refused that value.");
    const before = Object.fromEntries(Object.keys(s).map((k) => [k, cur.settings[k] ?? null]));
    recordConfigChange({ actorId: adminId, surface: "ad_pricing", targetId: "ad_platform_settings", action: "settings.update", before, after: s });
  }
  if (patch.placement) {
    const { code, ...fields } = patch.placement;
    const was = cur.placements.find((p) => p.code === code) ?? null;
    const { data, error } = await db.from("ad_placements").update({ ...fields, updated_at: now }).eq("code", code).select("code");
    if (error) throw new AdminFormatError("The database refused that value.");
    if (!data?.length) throw new AdminFormatError("No such placement.");
    recordConfigChange({ actorId: adminId, surface: "ad_pricing", targetId: `placement:${code}`, action: "placement.update", before: was, after: fields });
  }
  if (patch.duration) {
    const was = cur.durations.find((d) => d.id === patch.duration!.id) ?? null;
    const { data, error } = await db.from("ad_durations").update({ views_enabled: patch.duration.views_enabled, updated_at: now }).eq("id", patch.duration.id).select("id");
    if (error) throw new AdminFormatError("The database refused that value.");
    if (!data?.length) throw new AdminFormatError("No such campaign length.");
    recordConfigChange({ actorId: adminId, surface: "ad_pricing", targetId: `duration:${patch.duration.id}`, action: "duration.views", before: was, after: patch.duration });
  }
  if (patch.newDuration) {
    if (cur.durations.some((d) => d.duration_days === patch.newDuration!.days)) throw new AdminFormatError("A campaign length with that many days already exists — switch it on instead.");
    const { data, error } = await db.from("ad_durations").insert({ name: patch.newDuration.name, duration_days: patch.newDuration.days, enabled: true, sort_order: patch.newDuration.days }).select("id").single();
    if (error || !data) throw new AdminFormatError("The database refused that value.");
    recordConfigChange({ actorId: adminId, surface: "ad_pricing", targetId: `duration:${data.id as string}`, action: "duration.create", before: null, after: patch.newDuration });
  }
  return loadViewsAdmin(db);
}

export async function loadPlatform(db: Db): Promise<PlatformState> {
  const [settings, controls, blocked, formats, views] = await Promise.all([
    db.from("ad_platform_settings").select(SETTINGS_COLUMNS).eq("id", true).maybeSingle(),
    loadControls(db),
    db.from("ad_blocked_domains").select("domain, reason, created_at").order("created_at", { ascending: false }).limit(500),
    loadFormats(db).catch(() => [] as Record<string, unknown>[]),
    loadViewsAdmin(db).catch(() => null),
  ]);
  if (settings.error) throw new Error(`ad settings: ${settings.error.message}`);
  return {
    settings: (settings.data as Record<string, unknown> | null) ?? null,
    controls,
    blocked: ((blocked.data ?? []) as { domain: string; reason: string; created_at: string }[]).map((b) => ({ domain: b.domain, reason: b.reason, createdAt: b.created_at })),
    formats,
    views,
  };
}

export async function saveSettings(db: Db, adminId: string, patch: PlatformSettingsPatch): Promise<Record<string, unknown>> {
  const { data: before } = await db.from("ad_platform_settings").select(Object.keys(patch).join(", ") || "id").eq("id", true).maybeSingle();
  recordConfigChange({ actorId: adminId, surface: "ad_pricing", targetId: "ad_platform_settings", action: "platform.update", before: before ?? null, after: patch });
  const { data, error } = await db
    .from("ad_platform_settings")
    .upsert({ id: true, ...patch, updated_by: adminId, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select(SETTINGS_COLUMNS)
    .single();
  if (error) throw new Error(`ad settings save: ${error.message}`);
  return data as Record<string, unknown>;
}

export async function saveControls(db: Db, patch: Partial<AdvertiserControls>): Promise<AdvertiserControls> {
  const next = parseControls({ ...(await loadControls(db)), ...patch });
  const { error } = await db.from("settings").upsert({ key: AD_ADVERTISER_CONTROLS_KEY, value: next }, { onConflict: "key" });
  if (error) throw new Error(`advertiser controls save: ${error.message}`);
  return next;
}

export async function addBlockedDomain(db: Db, adminId: string, domain: string, reason: string): Promise<void> {
  const { error } = await db.from("ad_blocked_domains").upsert({ domain, reason: reason.trim().slice(0, 120) || "blocked by admin", created_by: adminId }, { onConflict: "domain" });
  if (error) throw new Error(`blocked domain add: ${error.message}`);
}

export async function removeBlockedDomain(db: Db, domain: string): Promise<void> {
  const { error } = await db.from("ad_blocked_domains").delete().eq("domain", domain);
  if (error) throw new Error(`blocked domain remove: ${error.message}`);
}

/* ─────────────────────────────── prices + promotions ─────────────────────────────── */

/** Ad checkout quotes are in USD (0198: the provider converts at checkout), so a USD row is the price. */
export const PRICE_CURRENCIES = ["USD"] as const;

export const priceSchema = z
  .object({
    placementId: z.string().uuid(),
    durationId: z.string().uuid(),
    currency: z.enum(PRICE_CURRENCIES),
    /** minor units: cents or kobo */
    priceMinor: z.number().int().min(0).max(10_000_000_000),
    enabled: z.boolean(),
  })
  .strict();

export const promotionSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).nullable().optional(),
    placementId: z.string().uuid().nullable(),
    durationId: z.string().uuid().nullable(),
    extraDays: z.number().int().min(0).max(366),
    discountPercent: z.number().min(0).max(100),
    startsAt: z.string().datetime({ offset: true }).nullable(),
    endsAt: z.string().datetime({ offset: true }).nullable(),
    enabled: z.boolean(),
  })
  .strict()
  .refine((p) => !p.startsAt || !p.endsAt || Date.parse(p.endsAt) > Date.parse(p.startsAt), { message: "The end must be after the start." })
  .refine((p) => p.extraDays > 0 || p.discountPercent > 0, { message: "A promotion needs a discount or extra days." });

export interface PricingState {
  placements: { id: string; code: string; name: string; format: string; enabled: boolean }[];
  durations: { id: string; name: string; days: number; enabled: boolean }[];
  prices: { placementId: string; durationId: string; currency: string; priceMinor: number; enabled: boolean }[];
  promotions: { id: string; name: string; description: string | null; placementId: string | null; durationId: string | null; extraDays: number; discountPercent: number; startsAt: string | null; endsAt: string | null; enabled: boolean }[];
}

export async function loadPricing(db: Db): Promise<PricingState> {
  const [pl, du, pr, po] = await Promise.all([
    db.from("ad_placements").select("id, code, name, format_code, enabled, sort_order").order("sort_order", { ascending: true }),
    db.from("ad_durations").select("id, name, duration_days, enabled, sort_order").order("sort_order", { ascending: true }),
    db.from("ad_pricing_plans").select("placement_id, duration_id, currency, price_minor, enabled"),
    db.from("ad_promotions").select("id, name, description, placement_id, duration_id, extra_days, discount_percent, starts_at, ends_at, enabled").order("created_at", { ascending: false }).limit(100),
  ]);
  if (pl.error || du.error || pr.error || po.error) throw new Error("ad pricing: load failed");
  return {
    placements: ((pl.data ?? []) as Record<string, unknown>[]).map((p) => ({ id: p.id as string, code: p.code as string, name: p.name as string, format: p.format_code as string, enabled: Boolean(p.enabled) })),
    durations: ((du.data ?? []) as Record<string, unknown>[]).map((d) => ({ id: d.id as string, name: d.name as string, days: Number(d.duration_days), enabled: Boolean(d.enabled) })),
    prices: ((pr.data ?? []) as Record<string, unknown>[]).map((p) => ({ placementId: p.placement_id as string, durationId: p.duration_id as string, currency: p.currency as string, priceMinor: Number(p.price_minor), enabled: Boolean(p.enabled) })),
    promotions: ((po.data ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      description: (p.description as string | null) ?? null,
      placementId: (p.placement_id as string | null) ?? null,
      durationId: (p.duration_id as string | null) ?? null,
      extraDays: Number(p.extra_days),
      discountPercent: Number(p.discount_percent),
      startsAt: (p.starts_at as string | null) ?? null,
      endsAt: (p.ends_at as string | null) ?? null,
      enabled: Boolean(p.enabled),
    })),
  };
}

/** A price change applies to NEW quotes only: an open quote keeps the price the advertiser was shown (0197). */
export async function savePrice(db: Db, p: z.infer<typeof priceSchema>, adminId: string | null = null): Promise<void> {
  // Part 3: the previous value goes in the audit trail with the new one
  const { data: before } = await db.from("ad_pricing_plans").select("price_minor, enabled").eq("placement_id", p.placementId).eq("duration_id", p.durationId).eq("currency", p.currency).maybeSingle();
  const { error } = await db
    .from("ad_pricing_plans")
    .upsert({ placement_id: p.placementId, duration_id: p.durationId, currency: p.currency, price_minor: p.priceMinor, enabled: p.enabled, updated_at: new Date().toISOString() }, { onConflict: "placement_id,duration_id,currency" });
  if (error) throw new Error(`price save: ${error.message}`);
  recordConfigChange({ actorId: adminId, surface: "ad_pricing", targetId: `price:${p.placementId}:${p.durationId}:${p.currency}`, action: "price.set", before: before ?? null, after: { price_minor: p.priceMinor, enabled: p.enabled } });
}

export async function savePromotion(db: Db, p: z.infer<typeof promotionSchema>): Promise<string> {
  const row = {
    name: p.name,
    description: p.description ?? null,
    placement_id: p.placementId,
    duration_id: p.durationId,
    extra_days: p.extraDays,
    discount_percent: p.discountPercent,
    starts_at: p.startsAt,
    ends_at: p.endsAt,
    enabled: p.enabled,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = p.id
    ? await db.from("ad_promotions").update(row).eq("id", p.id).select("id").maybeSingle()
    : await db.from("ad_promotions").insert(row).select("id").single();
  if (error || !data) throw new Error(`promotion save: ${error?.message ?? "not found"}`);
  return (data as { id: string }).id;
}
