import { z } from "zod";

/** Validation for admin ad-placement writes (AdSense / Adsterra / house). */

/**
 * Every placement the site can fill, in the reading order of the page.
 *
 * The admin dropdown renders this list, and an operator picking a placement is
 * thinking about WHERE it goes, not which component renders it — so the labels
 * and descriptions in `AD_ZONE_META` are part of the contract, not decoration.
 * A mis-placed ad is invisible to everyone except the visitor who sees it.
 */
export const AD_ZONES = [
  "global",
  "homepage_top",
  "under_download",
  "result_top",
  "download_result_page",
  "download_complete",
  "idle_interstitial",
  "reward_video",
  "sidebar",
  "bottom_banner",
  /* Legacy, kept so existing rows stay visible and editable in the admin rather
     than vanishing from the list they were created in. */
  "mobile_bottom_banner",
  "exit_intent_popup",
] as const;

export type AdZoneId = (typeof AD_ZONES)[number];

/**
 * Formats an ad row may use.
 *
 * `pop` is deliberately ABSENT. Pop-under / OnClick / Social Bar units monetise
 * by hijacking the visitor's first click, which is what produced the reported
 * "I click a button and it redirects me to an ad site". The decision was to drop
 * them in favour of `display` and `native` units placed as part of the design.
 *
 * Removing it here stops new ones being created. `isServableFormat` stops
 * EXISTING ones being served, and the two are independent on purpose: the
 * migrations in this project are applied by hand, so the serving path must not
 * wait for one to land.
 */
export const AD_FORMATS = ["display", "native", "adsense", "video"] as const;

export type AdFormatId = (typeof AD_FORMATS)[number];

/** Formats that were once allowed and must never be served again. */
export const RETIRED_FORMATS = ["pop"] as const;

/**
 * The serving gate.
 *
 * Fails closed on any unknown string, not just the retired ones: a typo in a
 * hand-edited row should render nothing rather than fall through to the
 * `display` branch and inject whatever happens to be in `script_code`.
 */
export function isServableFormat(format: string | null | undefined): format is AdFormatId {
  return (AD_FORMATS as readonly string[]).includes(format ?? "");
}

export interface AdZoneMeta {
  label: string;
  description: string;
  /** Furniture rather than something a visitor dismisses — never gets an X. */
  persistent: boolean;
  /**
   * The visitor WAITS through this placement, so a skip control is meaningful
   * and `skippable` / `skip_after_seconds` apply.
   *
   * A property of the zone, kept here beside `persistent`, because the
   * alternative is each surface naming zone ids to decide — which is how three
   * separate copies of the zone list came to exist in the first place.
   */
  supportsSkip: boolean;
  /**
   * Worth warming as soon as the page loads.
   *
   * True for placements that can appear without any interaction, so their data
   * is already cached before the component mounts — the difference between an
   * ad that is there when the visitor looks and one that arrives after they
   * have downloaded and gone.
   *
   * False for placements that only exist after an action (a fetched result, a
   * completed download): requesting those up front would spend a round trip on
   * something most visitors never reach.
   */
  prefetch: boolean;
  deprecated?: boolean;
}

/** Zones to warm on page load. Derived, so the list cannot drift. */
export function prefetchZoneIds(): AdZoneId[] {
  return AD_ZONES.filter((z) => AD_ZONE_META[z].prefetch);
}

export const AD_ZONE_META: Record<AdZoneId, AdZoneMeta> = {
  global: {
    label: "Page-level script",
    description:
      "Loaded once per page and renders nothing itself. Use for an AdSense Auto ads loader or a network page tag.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
  },
  homepage_top: {
    label: "Home — above the platform strip",
    description: "Between the hero and the supported-platform row. Collapses when empty.",
    persistent: true,
    supportsSkip: false,
    prefetch: true,
  },
  under_download: {
    label: "Under the Download button",
    description:
      "Directly below the paste box and Download button, on the home page and every downloader page. The highest-attention placement on the site.",
    persistent: true,
    supportsSkip: false,
    prefetch: true,
  },
  result_top: {
    label: "Above a fetched result",
    description: "A strip above a result that dismisses itself after five seconds.",
    persistent: false,
    supportsSkip: false,
    prefetch: false,
  },
  download_result_page: {
    label: "Download result",
    description:
      "Shown alongside the result. Renders as a skippable video when the format is AdSense or video.",
    persistent: false,
    supportsSkip: true,
    prefetch: false,
  },
  download_complete: {
    label: "After a download finishes",
    description: "A skippable panel shown once the file has actually been saved.",
    persistent: false,
    supportsSkip: true,
    prefetch: false,
  },
  idle_interstitial: {
    label: "Idle interstitial",
    description:
      "Full screen, shown after the visitor has gone idle. Always closable from the top right.",
    persistent: false,
    supportsSkip: true,
    prefetch: true,
  },
  reward_video: {
    label: "Rewarded video (unlock HD)",
    description:
      "Watched to completion in exchange for an HD download. Never skippable — it is an exchange. AdSense is the intended network.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
  },
  sidebar: {
    label: "Blog sidebar",
    description: "In-article placement on blog posts. Collapses when empty.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
  },
  bottom_banner: {
    label: "Fixed bottom banner (all pages)",
    description:
      "Pinned to the bottom of the viewport on every page, on a solid card so it reads as part of the chrome. Not dismissible.",
    persistent: true,
    supportsSkip: false,
    prefetch: true,
  },
  mobile_bottom_banner: {
    label: "Fixed bottom banner — mobile only (legacy)",
    description:
      "Superseded by the all-pages bottom banner, which serves this zone as a fallback. Prefer the new placement.",
    persistent: true,
    supportsSkip: false,
    prefetch: false,
    deprecated: true,
  },
  exit_intent_popup: {
    label: "Exit intent",
    description:
      "Shown when the visitor looks like they are leaving — pointer to the address bar on desktop, tab hidden on mobile. Never traps the back button.",
    persistent: false,
    supportsSkip: false,
    prefetch: false,
  },
};

/** Zones whose unit is furniture — never given a dismiss control. */
export function isPersistentZone(zone: string): boolean {
  return AD_ZONE_META[zone as AdZoneId]?.persistent ?? false;
}

/* ------------------------- click-hijack script detection ------------------- */

/**
 * Hosts and markers that identify an OnClick / pop-under / Social Bar script.
 *
 * These are the invocation URLs the networks hand out for their INTERSTITIAL
 * products, as opposed to their banner products. The distinction is invisible
 * from the snippet itself — both are `<script src="…">` — which is exactly why
 * this exists.
 */
const HIJACK_MARKERS = [
  "effectivecpmnetwork.com",
  "effectivegatecpm.com",
  "highperformanceformat.com/js",
  "profitabledisplaynetwork.com",
  "popcash",
  "popads",
  "propellerads.com/ntfc",
  "onclickalgo",
  "adcash",
];

/**
 * Whether an embed looks like a click-hijacking unit rather than a banner.
 *
 * ── The mistake this catches ──────────────────────────────────────────────────
 *
 * A pop-under or OnClick script pasted into a `display` placement produces a
 * slot that renders NOTHING — those products have no visual creative; they
 * monetise by taking over the visitor's next click. The result is a blank space
 * that navigates somewhere unexpected when tapped, which is precisely what was
 * reported on this site.
 *
 * Nothing about the snippet says so. Both products are a one-line
 * `<script src>`, so an operator pasting the wrong one from their dashboard has
 * no feedback at all until a visitor complains.
 *
 * A heuristic, and deliberately advisory rather than blocking: these host lists
 * change, and refusing to save on a false positive would be worse than a
 * warning. The iframe sandbox in `AdSlot` is what actually prevents the hijack.
 */
export function looksLikeHijackScript(scriptCode: string | null | undefined): boolean {
  if (!scriptCode) return false;
  const s = scriptCode.toLowerCase();
  return HIJACK_MARKERS.some((marker) => s.includes(marker));
}

/**
 * Whether an embed looks like a genuine BANNER invocation.
 *
 * Adsterra banners carry an `atOptions` block with a size; PropellerAds banners
 * use their iframe/banner tag. Used only to make the admin warning specific —
 * "this looks like an OnClick script" is far more actionable than "this may not
 * render".
 */
export function looksLikeBannerScript(scriptCode: string | null | undefined): boolean {
  if (!scriptCode) return false;
  const s = scriptCode.toLowerCase();
  return s.includes("atoptions") || s.includes("data-cfasync") || /\bwidth\b.*\bheight\b/.test(s);
}

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const intField = (max: number) => z.number().int().min(0).max(max).nullable().optional();
const emptyToNull = z.literal("").transform(() => null);

const baseFields = {
  zone: z.enum(AD_ZONES),
  network: z.string().trim().min(1).max(40),
  format: z.enum(AD_FORMATS),
  script_code: z.string().max(20000).nullable().optional().or(emptyToNull),
  image_url: httpUrl,
  target_url: httpUrl,
  headline: z.string().trim().max(120).nullable().optional().or(emptyToNull),
  width: intField(4000),
  height: intField(4000),
  /*
    AdSense identifiers are shape-checked, not merely non-empty. A publisher id
    pasted without its `ca-pub-` prefix, or a slot id with stray characters,
    renders a unit that loads and earns nothing — and that failure is completely
    silent on the page, which is the worst kind this table can produce.
  */
  /*
    Normalised before validating, not merely trimmed.

    A publisher id arrives from a copy-paste, an autocapitalising keyboard, or
    retyping — so `Ca-pub-…` and `CA-PUB-…` are common, and rejecting them as
    malformed is both wrong (AdSense ids are case-insensitive) and infuriating,
    because the error names the exact string the operator believes they typed.
    Lowercase it and move on.
  */
  ad_client: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^ca-pub-\d{10,20}$/, "Should look like ca-pub-1234567890123456")
    .nullable()
    .optional()
    .or(emptyToNull),
  /* Strips spaces and dashes: AdSense displays slot ids grouped, and pasting
     the displayed form is the obvious thing to do. */
  ad_slot_id: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => /^\d{6,20}$/.test(v), "The numeric ad unit id from AdSense")
    .nullable()
    .optional()
    .or(emptyToNull),
  ad_layout: z.string().trim().max(40).nullable().optional().or(emptyToNull),
  skippable: z.boolean().optional(),
  skip_after_seconds: z.number().int().min(0).max(120).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  weight: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
};

/**
 * Cross-field rules, applied to both create and update.
 *
 * Every one of these describes a row that saves cleanly and then renders an
 * empty frame — the data form of the empty-box bug. The database has the same
 * constraint for the AdSense case; this exists so the admin shows a field error
 * instead of a constraint violation, and so the rule still holds before the
 * migration has been applied.
 */
function checkCoherence(
  v: {
    format?: string;
    ad_client?: string | null;
    ad_slot_id?: string | null;
    script_code?: string | null;
    target_url?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (v.format === "adsense") {
    if (!v.ad_client) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ad_client"],
        message: "AdSense placements need a publisher id",
      });
    }
    if (!v.ad_slot_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ad_slot_id"],
        message: "AdSense placements need an ad unit id",
      });
    }
  }
  if ((v.format === "display" || v.format === "video") && !v.script_code) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["script_code"],
      message: v.format === "video" ? "Video placements need a video URL" : "Paste the network embed code",
    });
  }
  if (v.format === "native" && !v.target_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["target_url"],
      message: "House ads need a click-through URL",
    });
  }
}

export const adCreateSchema = z.object(baseFields).superRefine(checkCoherence);

/*
  Update validates the same way, but only when `format` is part of the payload —
  a partial patch that just flips `active` must not be rejected for lacking
  fields it was never trying to change.
*/
export const adUpdateSchema = z
  .object(baseFields)
  .partial()
  .superRefine((v, ctx) => {
    if (v.format === undefined) return;
    checkCoherence(v, ctx);
  });

export type AdCreateInput = z.infer<typeof adCreateSchema>;
