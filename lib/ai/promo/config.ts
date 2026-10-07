import { SHOWCASE_TARGETS, SHOWCASE_VIDEO, isShowcaseImageUrl } from "@/lib/ai/showcase/slides";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI LANDING PROMOTION — what the admin sets, and how it plays
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Brief C (docs/FRENZ_AI_REDESIGN_BRIEFS.md) + the owner's 2026-10-05 answer:
 * "replace the explore button in the landing page with the frenz ai promo
 * showcase, and it should be very noticeable".
 *
 * The tile in the Explore slot plays, after a short delay:
 *   intro (Frenz AI + the rotating tool name) → a ~3 s clip → a before/after
 *   pair → intro → …
 * A stage with no media (or switched off) is skipped; with none at all the
 * tile is the intro alone, which is a complete, working tile on its own.
 *
 * Pure: no imports beyond the equally pure showcase module, so the landing
 * tile can read it without pulling anything onto the 1.6-second route.
 * Media lives in the existing `ai-showcase` bucket under `promo/`; only URLs
 * are stored (settings key `ai_promo`) — never bytes in the database.
 */

export interface AiPromoVideo {
  url: string;
  /** A still shown until the clip can play, and instead of it on slow / data-saving connections. */
  poster: string | null;
  enabled: boolean;
}

export interface AiPromoImage {
  /** "Original" — left half. */
  before: string;
  /** "Frenz AI result" — right half. */
  after: string;
  enabled: boolean;
}

/** Seconds. Clamped — an admin value cannot make the tile churn or stall. */
export interface AiPromoTiming {
  delay: number;
  intro: number;
  video: number;
  image: number;
}

export interface AiPromo {
  video: AiPromoVideo | null;
  image: AiPromoImage | null;
  timing: AiPromoTiming;
}

export const DEFAULT_PROMO_TIMING: AiPromoTiming = { delay: 2, intro: 3, video: 3, image: 3 };

/** The only bounds the admin can move within (Brief C §7: no setting that can create a performance problem). */
export const PROMO_TIMING_LIMITS = {
  delay: { min: 1, max: 10 },
  intro: { min: 2, max: 10 },
  video: { min: 2, max: 10 },
  image: { min: 2, max: 10 },
} as const;

export const EMPTY_PROMO: AiPromo = { video: null, image: null, timing: DEFAULT_PROMO_TIMING };

/** Where the uploads go inside the shared bucket. */
export const PROMO_PREFIX = "promo/";

/**
 * The tool names the tile's label rotates through — from the existing showcase
 * target registry, not a second hand-written list (Brief C §2). The two doors
 * that are not tools (the studio itself, your history) are left out.
 */
export const PROMO_FEATURES: readonly string[] = Object.entries(SHOWCASE_TARGETS)
  .filter(([id]) => id !== "explore" && id !== "history")
  .map(([, t]) => t.label);

function clampSeconds(v: unknown, key: keyof AiPromoTiming): number {
  const { min, max } = PROMO_TIMING_LIMITS[key];
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_PROMO_TIMING[key];
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

const isOurs = (v: unknown, supabaseUrl: string | undefined): v is string =>
  isShowcaseImageUrl(v, supabaseUrl) && (v as string).includes(`/${PROMO_PREFIX}`);

/** Whatever was stored, as something the tile can trust: our bucket only, MP4/WebM only, timing clamped. */
export function normalizePromo(value: unknown, supabaseUrl: string | undefined): AiPromo {
  if (!value || typeof value !== "object") return EMPTY_PROMO;
  const v = value as Record<string, unknown>;

  let video: AiPromoVideo | null = null;
  const rv = v.video as Record<string, unknown> | null | undefined;
  if (rv && typeof rv === "object" && isOurs(rv.url, supabaseUrl) && /\.(mp4|webm)$/i.test(rv.url as string)) {
    video = {
      url: rv.url as string,
      poster: isOurs(rv.poster, supabaseUrl) ? (rv.poster as string) : null,
      enabled: rv.enabled !== false,
    };
  }

  let image: AiPromoImage | null = null;
  const ri = v.image as Record<string, unknown> | null | undefined;
  if (ri && typeof ri === "object" && isOurs(ri.before, supabaseUrl) && isOurs(ri.after, supabaseUrl)) {
    image = { before: ri.before as string, after: ri.after as string, enabled: ri.enabled !== false };
  }

  const rt = (v.timing ?? {}) as Record<string, unknown>;
  const timing: AiPromoTiming = {
    delay: clampSeconds(rt.delay, "delay"),
    intro: clampSeconds(rt.intro, "intro"),
    video: clampSeconds(rt.video, "video"),
    image: clampSeconds(rt.image, "image"),
  };
  return { video, image, timing };
}

export type PromoStage = "intro" | "video" | "image";

/**
 * The loop, with every missing or switched-off stage dropped (Brief C §20):
 * no video → intro, image, …; no image → intro, video, …; neither → intro only.
 */
export function promoStages(p: AiPromo): PromoStage[] {
  const out: PromoStage[] = ["intro"];
  if (p.video?.enabled) out.push("video");
  if (p.image?.enabled) out.push("image");
  return out;
}

/** Same limits as the showcase clip — one bucket, one rule. */
export const PROMO_VIDEO = SHOWCASE_VIDEO;
