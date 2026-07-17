"use client";

import { useSearchParams } from "next/navigation";

import { Downloader } from "@/features/downloader/downloader";
import { extractSharedUrl } from "@/lib/share-target";

/**
 * The hero's paste-a-link tool, pre-filled from a PWA Share Target hand-off.
 *
 * Reading the shared link on the CLIENT (rather than from the page's
 * `searchParams`) is what keeps `/` statically generated: touching
 * `searchParams` in a server page opts the whole route out of static rendering,
 * exactly like `cookies()` did. `/` is the first page a new visitor ever loads,
 * so it has to be a CDN document — see docs/FEATURE_21_LANDING.md §4.
 *
 * Must be wrapped in <Suspense>: useSearchParams() suspends during prerender,
 * and the boundary is what lets the rest of the page prerender around it. The
 * fallback is the same tool with an empty field, so the static HTML already
 * contains a usable downloader and nothing shifts when this resolves.
 *
 * Validation is unchanged — `extractSharedUrl` applies the same
 * `sourceUrlSchema` the server used, so `Downloader`'s "already validated"
 * assumption still holds.
 */
export function SharedLinkDownloader() {
  const params = useSearchParams();
  const initialUrl = extractSharedUrl({
    url: params.get("url"),
    text: params.get("text"),
  });
  return <Downloader initialUrl={initialUrl} />;
}
