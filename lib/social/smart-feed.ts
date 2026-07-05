import type { FeedItem } from "./home-feed";

/**
 * Smart Feed engine (Feature 5) — pure, deterministic transforms that turn a raw
 * page of feed items into an intelligent, balanced, self-explaining stream.
 *
 * All logic here is client-safe (only the `FeedItem` type is imported) and has no
 * side effects, so it can run on the server for seeding or on the client while
 * scrolling. It intentionally avoids any heavy ML: ranking is a transparent,
 * auditable score over signals we already store. Naming stays "smart", never "AI".
 */

/* ── Smart Explanation ─────────────────────────────────────────────────────── */

export type SmartReasonTone = "follow" | "fresh" | "hot" | "interest" | "download";

export interface SmartReason {
  tone: SmartReasonTone;
  label: string;
}

const HOUR = 3_600_000;

/** Engagement velocity: weight conversation + shares above passive likes. */
function engagementScore(i: FeedItem): number {
  return i.likesCount + i.commentsCount * 2 + i.sharesCount * 3 + i.savesCount * 2;
}

/**
 * The single most relevant reason a viewer is seeing this item. Priority is
 * chosen so the explanation feels earned, not generic: a real relationship
 * (follow) beats momentum (hot/download) beats freshness beats topic.
 */
export function feedReason(item: FeedItem): SmartReason | null {
  const ageH = (Date.now() - new Date(item.createdAt).getTime()) / HOUR;
  if (item.isFollowing) return { tone: "follow", label: "From someone you follow" };
  if (item.downloadsCount >= 25) return { tone: "download", label: "Trending download" };
  if (engagementScore(item) >= 80 && ageH < 48) return { tone: "hot", label: "Popular right now" };
  if (ageH < 3) return { tone: "fresh", label: "Fresh now" };
  if (item.category) return { tone: "interest", label: `Popular in ${item.category}` };
  return null;
}

/* ── Smart Content Balance ─────────────────────────────────────────────────── */

/**
 * Reorder so no more than two items of the same media kind appear back-to-back —
 * the feed never feels like "10 videos in a row". Stable otherwise: we only pull
 * the next differently-typed item forward when a run would exceed the cap, so the
 * base ranking is preserved as much as possible.
 */
export function balanceByKind(items: FeedItem[], maxRun = 2): FeedItem[] {
  const pool = [...items];
  const out: FeedItem[] = [];
  let lastKind: string | null = null;
  let run = 0;
  while (pool.length) {
    let idx = 0;
    if (lastKind && run >= maxRun) {
      const alt = pool.findIndex((p) => p.mediaKind !== lastKind);
      if (alt !== -1) idx = alt;
    }
    const next = pool.splice(idx, 1)[0];
    if (!next) break;
    if (next.mediaKind === lastKind) run += 1;
    else {
      lastKind = next.mediaKind;
      run = 1;
    }
    out.push(next);
  }
  return out;
}

/* ── Spark Cards (exclusive #3) ────────────────────────────────────────────── */

export type SparkKind = "creator" | "community" | "download" | "milestone" | "friends";

export interface SparkCard {
  id: string;
  kind: SparkKind;
  title: string;
  body: string;
  href: string;
  cta: string;
}

export interface SparkContext {
  /** Total friends — powers the milestone card ("Celebrate your Nth friend"). */
  friendCount?: number;
}

/**
 * A rotating deck of elegant discovery cards. They point at real destinations and
 * are always clearly a discovery, never an ad. The deck is contextual: milestone
 * cards only appear when the number is worth celebrating.
 */
export function buildSparkDeck(ctx: SparkContext = {}): SparkCard[] {
  const deck: SparkCard[] = [
    {
      id: "spark-creator",
      kind: "creator",
      title: "Discover a new creator",
      body: "People with taste like yours are worth following.",
      href: "/explore",
      cta: "Explore creators",
    },
    {
      id: "spark-download",
      kind: "download",
      title: "Trending downloads today",
      body: "The videos and reels everyone is saving right now.",
      href: "/explore?sort=trending",
      cta: "See what's trending",
    },
    {
      id: "spark-friends",
      kind: "friends",
      title: "Find your people",
      body: "Suggested friends who share your interests.",
      href: "/friends",
      cta: "Open Friends",
    },
  ];

  const milestones = [10, 25, 50, 100, 250, 500, 1000];
  if (ctx.friendCount && milestones.includes(ctx.friendCount)) {
    deck.unshift({
      id: `spark-milestone-${ctx.friendCount}`,
      kind: "milestone",
      title: `You reached ${ctx.friendCount} friends`,
      body: "Your circle is growing. Keep the momentum going.",
      href: "/friends",
      cta: "View your friends",
    });
  }
  return deck;
}

/* ── Stream assembly ───────────────────────────────────────────────────────── */

export type SmartSlot =
  | { type: "post"; item: FeedItem; reason: SmartReason | null }
  | { type: "spark"; card: SparkCard };

/**
 * Weave posts and Spark Cards into a single ordered stream. A spark card is
 * dropped in every `sparkEvery` posts (default 6), cycling through the deck, so
 * discovery moments feel occasional and intentional. Balancing runs first.
 */
export function buildSmartStream(
  items: FeedItem[],
  opts: { deck?: SparkCard[]; sparkEvery?: number; startIndex?: number; balance?: boolean } = {},
): SmartSlot[] {
  const deck = opts.deck ?? [];
  const sparkEvery = Math.max(3, opts.sparkEvery ?? 6);
  // Balancing is skipped when the caller already balanced each page on arrival
  // (prevents the loaded feed from visibly reshuffling as new pages append).
  const balanced = opts.balance === false ? items : balanceByKind(items);
  const slots: SmartSlot[] = [];
  const start = opts.startIndex ?? 0;

  balanced.forEach((item, i) => {
    slots.push({ type: "post", item, reason: feedReason(item) });
    const globalIndex = start + i + 1;
    if (deck.length && globalIndex % sparkEvery === 0) {
      const card = deck[Math.floor(globalIndex / sparkEvery - 1) % deck.length];
      if (card) slots.push({ type: "spark", card });
    }
  });
  return slots;
}

/* ── "While you were away" (exclusive #7) ──────────────────────────────────── */

export interface AwaySummary {
  newPosts: number;
  fromFollowing: number;
  sinceHours: number;
}

/**
 * Derive a truthful catch-up summary from the loaded page and the timestamp of
 * the viewer's last visit. Returns null when they were here recently (<6h) or
 * nothing new arrived — the summary should feel like a genuine welcome-back, not
 * noise on every open.
 */
export function summarizeAway(items: FeedItem[], lastVisitMs: number | null): AwaySummary | null {
  if (!lastVisitMs) return null;
  const sinceHours = (Date.now() - lastVisitMs) / HOUR;
  if (sinceHours < 6) return null;
  const fresh = items.filter((i) => new Date(i.createdAt).getTime() > lastVisitMs);
  if (fresh.length === 0) return null;
  return {
    newPosts: fresh.length,
    fromFollowing: fresh.filter((i) => i.isFollowing).length,
    sinceHours: Math.round(sinceHours),
  };
}
