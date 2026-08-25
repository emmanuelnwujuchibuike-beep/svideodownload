import { getDiscoveryFeed } from "./discovery";
import type { Category } from "./categories";
import { getFeed } from "./feed";
import { getHomeFeed } from "./home-feed";
import type { OrbitCard, OrbitId, OrbitResult } from "./orbits-catalogue";
import { postHref } from "./post-url";
import { listTrendingSounds } from "./sounds";
import { getNewCreators, getSuggestedCreators } from "./suggest";

/**
 * Discovery Orbit™ (Feature 15 Part 8) — instead of one "For You" algorithm,
 * several distinct, honestly-scoped feeds a viewer moves between. Every orbit
 * below is a thin adapter over a data function that already existed (or was
 * added earlier in this same Part) — this file adds NO new ranking model, it
 * normalizes their different shapes (posts, creators, sounds) into one
 * `OrbitCard` a single UI component can render.
 *
 * Community Orbit is the one honest exception: no `communities` table exists
 * in this app (confirmed absent — see docs/FEATURE_15_PART_8_DISCOVERY.md), so
 * it returns `deferred: true` with a real reason instead of fabricated rows.
 *
 * SERVER-ONLY — this file transitively imports server-only data functions
 * (getHomeFeed → posts.ts → lib/supabase/paginate.ts). The client-safe
 * tabs/types (`ORBITS`, `OrbitId`, `OrbitCard`, `OrbitResult`) live in
 * ./orbits-catalogue instead; import from there in any client component.
 */
export { ORBITS, type OrbitId, type OrbitCard, type OrbitResult } from "./orbits-catalogue";

const CATEGORY_ORBITS: Partial<Record<OrbitId, Category>> = {
  learning: "education",
  gaming: "gaming",
  travel: "travel",
  business: "business",
};

export async function getOrbitFeed(orbit: OrbitId, viewerId: string | null, limit = 12): Promise<OrbitResult> {
  switch (orbit) {
    case "friend": {
      const page = await getHomeFeed({ viewerId, sort: "following", format: "feed", limit });
      return { orbit, cards: page.items.map(postCard) };
    }
    case "creator": {
      const [fresh, established] = await Promise.all([
        getNewCreators(viewerId, Math.ceil(limit / 2)),
        getSuggestedCreators(viewerId, Math.ceil(limit / 2)),
      ]);
      const seen = new Set<string>();
      const cards: OrbitCard[] = [];
      for (const c of [...fresh, ...established]) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        cards.push({
          id: c.id,
          kind: "creator",
          href: `/u/${c.handle}`,
          title: c.displayName,
          subtitle: c.mutualFriendsCount > 0 ? `Followed by ${c.mutualFriendsCount} you follow` : `@${c.handle}`,
          imageUrl: c.avatarUrl,
        });
        if (cards.length >= limit) break;
      }
      return { orbit, cards };
    }
    case "music": {
      const sounds = await listTrendingSounds({ limit });
      return {
        orbit,
        cards: sounds.map((s) => ({
          id: s.id,
          kind: "sound" as const,
          href: `/sound/${s.id}`,
          title: s.title,
          subtitle: s.artistLabel,
          imageUrl: s.coverArtUrl,
        })),
      };
    }
    case "nearby": {
      const result = await getDiscoveryFeed(viewerId, { limit });
      return {
        orbit,
        cards: result.items.map((i) => ({
          id: i.id,
          kind: "post" as const,
          href: postHref({ id: i.id }),
          title: i.title,
          subtitle: i.nearby ? `Near you · @${i.handle}` : `@${i.handle}`,
          imageUrl: i.thumbnailUrl ?? i.mediaUrl,
        })),
      };
    }
    case "trending": {
      const posts = await getFeed({ sort: "trending", viewerId, limit });
      return {
        orbit,
        cards: posts.map((p) => ({
          id: p.id,
          kind: "post" as const,
          href: postHref({ id: p.id, category: p.category, createdAt: p.createdAt }),
          title: p.title,
          subtitle: p.category ?? undefined,
          imageUrl: p.thumbnailUrl ?? p.mediaUrl,
        })),
      };
    }
    case "community":
      return {
        orbit,
        cards: [],
        deferred: true,
        deferredReason:
          "Communities aren't built in this app yet — there's no communities table or backend to discover from. This is tracked, not silently skipped.",
      };
    default: {
      const category = CATEGORY_ORBITS[orbit];
      if (!category) return { orbit, cards: [] };
      const posts = await getFeed({ sort: "trending", category, viewerId, limit });
      return {
        orbit,
        cards: posts.map((p) => ({
          id: p.id,
          kind: "post" as const,
          href: postHref({ id: p.id, category: p.category, createdAt: p.createdAt }),
          title: p.title,
          subtitle: p.category ?? undefined,
          imageUrl: p.thumbnailUrl ?? p.mediaUrl,
        })),
      };
    }
  }
}

function postCard(item: { id: string; title: string; thumbnailUrl: string | null; mediaUrl: string | null; category: string | null; createdAt: string; publisher: { handle: string } }): OrbitCard {
  return {
    id: item.id,
    kind: "post",
    href: postHref({ id: item.id, category: item.category, createdAt: item.createdAt }),
    title: item.title,
    subtitle: `@${item.publisher.handle}`,
    imageUrl: item.thumbnailUrl ?? item.mediaUrl,
  };
}
