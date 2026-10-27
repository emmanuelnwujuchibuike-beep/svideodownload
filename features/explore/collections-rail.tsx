import { Music2, Users } from "lucide-react";
import Image from "next/image";

import { PendingLink } from "@/features/frenz-ui/pending";
import type { VideoCollection } from "@/lib/social/discovery-collections";
import type { OrbitCard } from "@/lib/social/orbits";
import { cn } from "@/lib/utils";

/**
 * Video Collections (Feature 15 Part 8) — a stack of labeled rails, each a real, distinct computed slice (see
 * lib/social/collections.ts). A plain server component: fetched once on the server and rendered statically.
 *
 * On the Discover design since 2026-10-27 (/explore): Sora section headings, the 3:4 rounded tiles the rest of
 * the screen uses, and links that never prefetch on their own — the old tile's viewport prefetch fired while
 * this cold-entry page was still loading (the warm-after-load rule, features/ui/warm-after-load.test.ts).
 */
export function CollectionsRail({ collections }: { collections: VideoCollection[] }) {
  if (collections.length === 0) return null;

  return (
    <div>
      {collections.map((c) => (
        <section key={c.id} aria-label={c.label}>
          <h2 className="px-1 pb-2.5 pt-[26px] font-heading text-[19px] font-bold tracking-[-0.4px]">{c.label}</h2>
          <div className="srch-rail -mx-4 scroll-px-4 gap-2.5 px-4 pb-1">
            {c.cards.map((card) => (
              <CollectionTile key={card.id} card={card} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CollectionTile({ card }: { card: OrbitCard }) {
  const isPerson = card.kind === "creator";
  return (
    <PendingLink href={card.href} prefetch={false} className="block w-[128px] shrink-0 rounded-[18px]" inner="block">
      <span className={cn("relative block overflow-hidden bg-frenz-fill", isPerson ? "aspect-square rounded-full" : "aspect-[3/4] rounded-[18px]")}>
        {card.imageUrl ? (
          <Image src={card.imageUrl} alt="" fill sizes="128px" loading="lazy" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-frenz-muted">
            {card.kind === "sound" ? <Music2 className="h-6 w-6" aria-hidden /> : <Users className="h-6 w-6" aria-hidden />}
          </span>
        )}
      </span>
      <span className="mt-1.5 block truncate text-left text-[14px] font-bold text-frenz-ink">{card.title}</span>
      {card.subtitle ? <span className="block truncate text-left text-[13px] text-frenz-muted">{card.subtitle}</span> : null}
    </PendingLink>
  );
}
