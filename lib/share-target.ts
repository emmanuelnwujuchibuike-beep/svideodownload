import { sourceUrlSchema } from "@/lib/validation";

/**
 * manifest.ts `share_target` posts to the landing page as a GET with these
 * params when someone shares a link into Frenz from another app (e.g.
 * TikTok/Instagram's own "Share" sheet). Some senders put the link in `url`,
 * others just dump it in `text` — check both.
 *
 * Reuses the same schema the download APIs validate against, so a malformed or
 * unsafe value is silently dropped rather than handed to the client unchecked.
 * This validation is the reason `Downloader` can trust `initialUrl` and fetch
 * metadata for it without re-checking — keep it that way if this moves again.
 *
 * Lives in lib/ (not app/page.tsx) so the client can apply the identical check:
 * the landing page reads these params via useSearchParams() on the client now,
 * which is what lets `/` stay a static, CDN-cached document. See middleware.ts.
 */
export function extractSharedUrl(params: {
  url?: string | null;
  text?: string | null;
}): string | undefined {
  const candidates = [params.url, params.text?.match(/https?:\/\/\S+/)?.[0]];
  for (const candidate of candidates) {
    if (candidate && sourceUrlSchema.safeParse(candidate).success) return candidate;
  }
  return undefined;
}
