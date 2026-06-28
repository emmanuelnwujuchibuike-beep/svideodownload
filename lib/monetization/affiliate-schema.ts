import { z } from "zod";

import { PLACEMENTS } from "./tools";

/**
 * Validation for admin affiliate / recommended-tool writes. Shared by the
 * create (POST) and update (PATCH) routes. Create requires name + url; update
 * accepts a partial.
 */

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL");

const optionalIso = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

export const affiliateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: httpUrl,
  description: z.string().trim().max(300).nullable().optional(),
  image_url: httpUrl.nullable().optional().or(z.literal("").transform(() => null)),
  cta: z.string().trim().max(40).optional(),
  category: z.string().trim().max(40).nullable().optional(),
  placements: z.array(z.enum(PLACEMENTS)).max(PLACEMENTS.length).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
  weight: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
  starts_at: optionalIso,
  ends_at: optionalIso,
});

export const affiliateUpdateSchema = affiliateCreateSchema.partial();

export type AffiliateCreateInput = z.infer<typeof affiliateCreateSchema>;
export type AffiliateUpdateInput = z.infer<typeof affiliateUpdateSchema>;
