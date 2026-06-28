import { z } from "zod";

/** Validation for admin ad-placement writes (Adsterra / PropellerAds / house). */

export const AD_ZONES = [
  "global",
  "homepage_top",
  "download_result_page",
  "result_top",
  "reward_video",
  "sidebar",
  "exit_intent_popup",
  "mobile_bottom_banner",
] as const;

export const AD_FORMATS = ["display", "pop", "native", "video"] as const;

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

export const adCreateSchema = z.object({
  zone: z.enum(AD_ZONES),
  network: z.string().trim().min(1).max(40),
  format: z.enum(AD_FORMATS),
  script_code: z.string().max(20000).nullable().optional().or(z.literal("").transform(() => null)),
  image_url: httpUrl,
  target_url: httpUrl,
  headline: z.string().trim().max(120).nullable().optional().or(z.literal("").transform(() => null)),
  width: intField(4000),
  height: intField(4000),
  priority: z.number().int().min(0).max(1000).optional(),
  weight: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
});

export const adUpdateSchema = adCreateSchema.partial();

export type AdCreateInput = z.infer<typeof adCreateSchema>;
