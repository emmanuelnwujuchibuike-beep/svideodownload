import { z } from "zod";

import { clampTitle, TITLE_MAX_CHARS } from "@/lib/downloads/title";
import { SOURCE_URL_EMPTY, SOURCE_URL_MAX, SOURCE_URL_TOO_LONG, sourceUrlProblem } from "@/lib/source-url";

/**
 * A text field that is SHORTENED to `max` characters rather than refused (lib/downloads/title.ts): a post's caption is
 * data we pass along, never something the member typed against a limit. A runaway input is cut before any work is done
 * on it. `inner` adds the field's own rules (e.g. min(1)) to the shortened value.
 */
export function clampedString(max: number, inner: z.ZodString = z.string()) {
  return z.preprocess((v) => (typeof v === "string" ? clampTitle(v.slice(0, 20_000), max) : v), inner);
}

/**
 * URL validation shared by the metadata and download endpoints. The rules live in lib/source-url.ts
 * (no zod) so the browser's paste box can run them without this file; this schema runs the same ones.
 * 🔴 Client code imports lib/source-url.ts, never this file — it would pull zod into the landing.
 */
export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, SOURCE_URL_EMPTY)
  .max(SOURCE_URL_MAX, SOURCE_URL_TOO_LONG)
  .superRefine((value, ctx) => {
    const problem = sourceUrlProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

export const metadataRequestSchema = z.object({
  url: sourceUrlSchema,
  /*
    0267 (2026-10-22): who is asking, for the ban check (lib/security/app-bans.ts). All optional — an
    older page sends none and is still served. Sent in the BODY because a browser-direct call to the
    worker carries no cookies and no custom headers (a custom header would cost a CORS preflight).
  */
  d: z.string().trim().max(64).optional(),
  f: z.string().trim().max(128).optional(),
  t: z.string().max(4096).optional(),
});

export const downloadRequestSchema = z.object({
  url: sourceUrlSchema,
  /** yt-dlp format id (or selector keyword) chosen from the preview. */
  formatId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_+\-./]+$/, "Invalid format selector."),
  kind: z.enum(["video", "audio", "image"]).default("video"),
  /**
   * Optional title from the preview, used only for the download filename. A long caption is SHORTENED, never a reason
   * to refuse the download (lib/downloads/title.ts — it used to fail every post captioned over 300 characters).
   */
  title: clampedString(TITLE_MAX_CHARS).optional(),
});

export type MetadataRequest = z.infer<typeof metadataRequestSchema>;
export type DownloadRequest = z.infer<typeof downloadRequestSchema>;
