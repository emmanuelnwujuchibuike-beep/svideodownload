import { OrbitCardTile } from "@/features/explore/orbit-rail";
import type { VideoCollection } from "@/lib/social/discovery-collections";

/**
 * Video Collections (Feature 15 Part 8) — a stack of labeled rails, each a
 * real, distinct computed slice (see lib/social/collections.ts). A plain
 * server component: the data is fetched once on the server and rendered
 * statically — no tab-switching state to justify a client island here,
 * unlike OrbitRail. Reuses OrbitRail's own tile renderer so a card looks
 * identical whichever rail it's found in.
 */
export function CollectionsRail({ collections }: { collections: VideoCollection[] }) {
  if (collections.length === 0) return null;

  return (
    <div className="mb-4 space-y-4">
      {collections.map((c) => (
        <div key={c.id}>
          <p className="mb-1.5 text-sm font-semibold">{c.label}</p>
          <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollSnapType: "x mandatory" }}>
            {c.cards.map((card) => (
              <OrbitCardTile key={card.id} card={card} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
