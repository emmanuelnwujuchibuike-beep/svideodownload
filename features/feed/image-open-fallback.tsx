import type { FeedItem } from "@/lib/social/home-feed";

/**
 * Painted the INSTANT a photo is tapped — before the real `ImageViewer` chunk
 * (which bundles Comments/ReportSheet/CollectionPicker/PostEditSheet, a
 * sizable amount of code deliberately kept out of the main feed bundle) has
 * even resolved. Shows the exact same media the real viewer shows, pixel for
 * pixel (`object-contain` + the same blurred backdrop fill, same layout), so
 * the handoff once the real chunk mounts is invisible. Without this there was
 * a beat where a tap did nothing at all while the chunk fetched — no
 * "loading" cue, just unresponsive — which is exactly what reads as
 * "navigated to a different page and is loading."
 */
export function ImageOpenFallback({ item, startIndex }: { item: FeedItem; startIndex: number }) {
  const slide = item.mediaItems && item.mediaItems.length > 1 ? item.mediaItems[startIndex] : null;
  const src = slide?.url ?? item.mediaUrl ?? item.thumbnailUrl ?? "";
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[85] flex bg-black lg:left-64" role="presentation" aria-hidden>
      <div className="relative h-full flex-1 lg:pr-24">
        <div className="absolute inset-0 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="max-h-full max-w-full object-contain" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-30 blur-2xl" />
        </div>
      </div>
    </div>
  );
}
