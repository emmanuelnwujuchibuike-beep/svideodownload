import { z } from "zod";

/**
 * URL validation shared by the metadata and download endpoints.
 * We only accept http/https and reject hosts that resolve to private /
 * loopback ranges to mitigate SSRF, since yt-dlp will fetch the URL server-side.
 */

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^\[?::1\]?$/, // ipv6 loopback
  /^\[?fc00:/i, // ipv6 unique local
  /^\[?fe80:/i, // ipv6 link local
  /\.local$/i,
];

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, "Please paste a link.")
  .max(2048, "That URL is too long.")
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "That doesn't look like a valid URL.",
      });
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only http and https links are supported.",
      });
      return;
    }

    if (isPrivateHost(url.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "That host is not allowed.",
      });
    }
  });

export const metadataRequestSchema = z.object({
  url: sourceUrlSchema,
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
  /** Optional title from the preview, used only for the download filename. */
  title: z.string().trim().max(300).optional(),
});

export type MetadataRequest = z.infer<typeof metadataRequestSchema>;
export type DownloadRequest = z.infer<typeof downloadRequestSchema>;
