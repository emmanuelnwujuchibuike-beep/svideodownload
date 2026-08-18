import { z } from "zod";

import { AD_FORMATS, AD_ZONES } from "@/lib/monetization/ad-schema";

/**
 * Zod write-validation for admin ad-placement writes (AdSense / Adsterra / house).
 *
 * Split out of `ad-schema.ts` (2026-08-18): that file's plain zone/format
 * lookups (`isPersistentZone`, `sizeFromScript`, …) are imported by the
 * CLIENT-SIDE `AdSlot` component, and zod's schema construction below runs at
 * module scope — so keeping it in the same file meant every page rendering an
 * ad shipped the whole zod runtime just to read a boolean off a lookup table.
 * This file is server-only (imported from the admin write routes); nothing
 * here should ever be imported from a "use client" file.
 */

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
