import { MapPin, Play } from "lucide-react";
import Link from "next/link";

import type { DiscoveryItem } from "@/lib/social/discovery";

/**
 * Discovery grid for the bottom of /friends — fresh videos & photos from people
 * the viewer hasn't followed or friended yet, so there's always someone new to
 * meet. When location is known, nearby creators lead and get a "Near you" pin.
 * Pure links (no client JS): the media opens the post, the chip opens the profile.
 */
export function NearbyDiscovery({ items }: { items: DiscoveryItem[] }) {
  if (items.length === 0) return null;
  // Only claim "near you" when we actually surfaced someone in the same place.
  const anyNearby = items.some((i) => i.nearby);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-[-0.01em]">
          {anyNearby ? <MapPin className="h-4 w-4 text-foreground" /> : null}
          {anyNearby ? "Discover people near you" : "Discover people"}
        </h2>
        <Link href="/explore" className="text-xs font-semibold text-primary hover:underline">
          See more
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.id} className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft">
            <Link href={`/p/${it.id}`} className="block">
              <div className="relative aspect-square overflow-hidden bg-neutral-900">
                {it.thumbnailUrl || (it.mediaKind === "image" && it.mediaUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.thumbnailUrl || it.mediaUrl || ""}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-600/25 to-violet-600/25 text-white/40">
                    <Play className="h-8 w-8" />
                  </div>
                )}
                {it.mediaKind === "video" ? (
                  <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
                    <Play className="h-3 w-3 fill-current" />
                  </span>
                ) : null}
                {it.nearby ? (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                    <MapPin className="h-2.5 w-2.5" /> Near you
                  </span>
                ) : null}
                {/* Bottom gradient so the creator chip is always legible */}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
              </div>
            </Link>

            {/* Creator chip */}
            <Link
              href={`/u/${it.handle}`}
              className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-2.5"
            >
              {it.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover ring-2 ring-white/20" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-[11px] font-bold text-white ring-2 ring-white/20">
                  {it.displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 truncate text-xs font-semibold text-white drop-shadow">{it.displayName}</span>
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
