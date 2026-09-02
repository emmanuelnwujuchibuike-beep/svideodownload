import { CLUSTERS, type SeoCluster, type SeoModifier } from "@/config/seoPages";
import {
  platformContentFor,
  type PlatformFeature,
  type PlatformStep,
} from "@/lib/seo/platform-content";
import type { PlatformId } from "@/types";

/** A fully-resolved, render-ready SEO page (generated from cluster × modifier). */
export interface SeoPage {
  slug: string;
  clusterId: string;
  platformId: PlatformId;
  brand: string;
  thing: string;
  title: string;
  description: string;
  h1: string;
  tagline: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  /**
   * SEO body paragraphs: an intro, the modifier's own angle, and two rotated
   * platform facts. No length target — see buildPage's note on the two
   * closing paragraphs removed 2026-08-23 for existing purely to pad word
   * count, which is the opposite of what this array should optimise for.
   */
  about: string[];
  benefits: { title: string; text: string }[];
  faqs: { q: string; a: string }[];
  /**
   * Step-by-step instructions for this PLATFORM's own apps, when written.
   *
   * Split by surface because the two genuinely differ — the mobile route goes
   * through a share sheet, the desktop one through the address bar — and a
   * single merged list would have to hedge, which is how the old shared copy
   * ended up saying nothing specific to anywhere.
   */
  steps?: { mobile: PlatformStep[]; desktop: PlatformStep[] };
  /** Feature cards, platform-specific where written. */
  features?: PlatformFeature[];
  /** True for the first (canonical) page in each cluster. */
  isPrimary: boolean;
}

/* ---------------------------------- utils --------------------------------- */

function fill(tpl: string, brand: string, thing: string): string {
  return tpl.replaceAll("{brand}", brand).replaceAll("{thing}", thing);
}

/** Small deterministic hash so rotations are stable per slug (no duplication churn). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Pick `count` items starting at a stable offset (wraps around). */
function rotate<T>(arr: T[], seed: number, count: number): T[] {
  if (arr.length <= count) return arr;
  const start = seed % arr.length;
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(arr[(start + i) % arr.length]!);
  return out;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, s.lastIndexOf(" ", max - 1)).trim() + "…";
}

/* -------------------------------- generation ------------------------------ */

function buildPage(
  cluster: SeoCluster,
  modifier: SeoModifier,
  index: number,
): SeoPage {
  const brand = cluster.brand;
  const thing = modifier.thing ?? cluster.thing;
  const slug = `${cluster.stem}-${modifier.slug}`;
  const seed = hash(slug);

  const f = (s: string) => fill(s, brand, thing);

  const platformTitle = platformContentFor(cluster.platformId);
  /* The canonical page per platform gets the hand-written title; modifier pages
     keep their own, which are already intent-distinct (HD / MP3 / iPhone). */
  const title = index === 0 && platformTitle ? platformTitle.title : f(modifier.title);
  const keyword = f(modifier.keyword);

  const secondaryKeywords = [
    ...(modifier.secondary ?? []).map(f),
    `${brand} downloader`,
    f(`download ${brand} ${thing}`),
  ];

  /*
    🔴 REMOVED 2026-08-23 (AdSense "Low value content" audit): two closing
    paragraphs used to sit here, and the comment above them said exactly what
    they were for — "keep each page over the 300-word target". That is
    padding: text whose job is to hit a length, not to tell a visitor
    something. Worse, the FIRST one was close to word-for-word identical on
    every one of the ~160 generated pages regardless of platform ("On any
    device — iPhone, Android, Windows or Mac — the {keyword} works the same
    way…"), which is a duplicate-content signal repeated at scale, not a
    quality signal.

    Nothing replaces them. `about` below is intro + the modifier's own angle +
    two platform-specific facts — genuine content, and shorter without the
    filler is a better page than longer with it. See the sibling MERGE in
    config/seoPages.ts for the larger fix this was found alongside: most of
    this padding lived on pages (iphone/android/pc aside) that were themselves
    near-duplicates of the platform's primary page.
  */
  /*
    ═══════════════════════════════════════════════════════════════════════════
     🔴 PLATFORM-SPECIFIC CONTENT REPLACES THE SHARED POOLS
    ═══════════════════════════════════════════════════════════════════════════

    Owner, 2026-09-02, after a THIRD AdSense "low value content" rejection.
    Measured across the 82 generated pages, with brand names masked so "the same
    sentence with a different brand" counts as shared — which is what a crawler
    sees:

        faqs 90% · benefits 87% · descriptions 87% · about 82% · titles 74%

    One FAQ appeared on 29 of 82 pages. The cause is structural, not editorial:
    `cluster.baseFaqs`, `cluster.baseBenefits` and the shared `{brand}`
    modifiers were designed to be reused across platforms, so scale multiplied
    the same paragraphs instead of adding information.

    `lib/seo/platform-content.ts` is hand-written per platform and takes
    precedence over every shared pool below. The modifier's OWN angle, benefit
    and FAQs survive — those are genuinely intent-specific (HD vs MP3 vs
    iPhone) and were never the duplication — but the generic filler around them
    is gone.

    The `cluster.intros`/`facts`/`baseFaqs` fallback is kept for any platform
    that has no hand-written entry yet, so adding a cluster never produces a
    blank page. A guard test fails the build if duplication climbs back.
  */
  const pc = platformContentFor(cluster.platformId);

  /*
    🔴 A SHARED MODIFIER'S PROSE IS SUPPRESSED ENTIRELY.

    `mHd`/`mMp3`/`mIphone`/`mAndroid`/`mPc` are single objects spread onto 9-11
    clusters, so their angle, benefit and FAQs appeared verbatim on 9-11 pages
    with only the brand swapped — measured as the ENTIRE remaining duplication
    after the platform rewrite. Their slug, title, keyword and tagline stay,
    because those carry real search intent and do vary; the prose is replaced by
    the platform's own, which differs genuinely (a TikTok share sheet and a
    Reddit comments page are not the same three taps).
  */
  const sharedProse = modifier.generic === true && !!pc;

  const about = pc
    ? index === 0
      ? [...pc.intro, f(modifier.angle)]
      : sharedProse
        ? rotate(pc.intro, seed, 2)
        : /* A platform-specific variant leads with its OWN intent and takes one
             platform paragraph for grounding, rather than repeating the full
             platform essay the canonical page already carries. */
          [f(modifier.angle), ...rotate(pc.intro, seed, 1)]
    : [
        f(cluster.intros[seed % cluster.intros.length]!),
        f(modifier.angle),
        ...rotate(cluster.facts, seed, 2).map(f),
      ];

  /*
    🔴 THE CANONICAL PAGE GETS EVERYTHING; THE VARIANTS GET A SLICE.

    Measured after the first pass of this fix: cross-PLATFORM duplication
    collapsed (descriptions 87% -> 0%), but FAQs and benefits went UP, to 92%.
    The reason is worth writing down, because it is counter-intuitive and it is
    the trap in "just add unique content": the platform's five FAQs were being
    printed on all twelve of that platform's pages, so the duplication simply
    moved from between-platforms to within-platform.

    So the primary page — the one that should rank, and the 301 target for the
    rest — carries the full set, and each variant takes a rotated slice seeded
    by its own slug. Two variants of the same platform therefore show different
    questions, while every page still answers something real.

    ⚠️ This narrows the gap; it does not close it. Eleven platforms cannot
    honestly support eighty-two substantially different pages, and the device
    variants (-for-iphone/-android/-pc, 33 of the 82) remain the same tool with
    a device word swapped. That is a page-count decision, not a copy decision —
    see the note in the guard test.
  */
  const benefits = pc
    ? sharedProse
      ? rotate(pc.features, seed, 4)
      : [
          { title: f(modifier.benefit.title), text: f(modifier.benefit.text) },
          ...(index === 0 ? pc.features : rotate(pc.features, seed, 3)),
        ]
    : [
        { title: f(modifier.benefit.title), text: f(modifier.benefit.text) },
        ...cluster.baseBenefits,
      ];

  const faqs = pc
    ? sharedProse
      ? rotate(pc.faqs, seed, 3)
      : [
          ...modifier.faqs.map((q) => ({ q: f(q.q), a: f(q.a) })),
          ...(index === 0 ? pc.faqs : rotate(pc.faqs, seed, 2)),
        ]
    : [
        ...modifier.faqs.map((q) => ({ q: f(q.q), a: f(q.a) })),
        ...rotate(cluster.baseFaqs, seed, 3),
      ];

  /*
    🔴 THE DESCRIPTION WAS THE WORST OFFENDER AFTER THE FAQs (87% shared): one
    sentence with the brand swapped, on every page. The primary page now takes
    the platform's own written description; the modifier pages combine their own
    title with that platform's subtitle, so the pair varies on BOTH axes rather
    than neither.
  */
  const description = pc
    ? truncate(index === 0 ? pc.description : `${title} — ${pc.subtitle}`, 158)
    : truncate(
        f(
          `Free ${keyword}. Download ${brand} ${thing} in HD or MP3 — no app, no login, works on iPhone, Android & PC.`,
        ),
        158,
      );

  return {
    slug,
    clusterId: cluster.id,
    platformId: cluster.platformId,
    brand,
    thing,
    title,
    description,
    h1: modifier.h1 ? f(modifier.h1) : title,
    tagline: f(modifier.tagline),
    primaryKeyword: keyword,
    secondaryKeywords,
    about,
    benefits,
    faqs,
    steps: pc ? { mobile: pc.mobileSteps, desktop: pc.desktopSteps } : undefined,
    features: pc?.features,
    isPrimary: index === 0,
  };
}

export const ALL_PAGES: SeoPage[] = CLUSTERS.flatMap((cluster) =>
  cluster.modifiers.map((m, i) => buildPage(cluster, m, i)),
);

// Fail fast in dev if two modifiers collide on a slug.
const seen = new Set<string>();
for (const p of ALL_PAGES) {
  if (seen.has(p.slug)) {
    throw new Error(`Duplicate SEO slug generated: ${p.slug}`);
  }
  seen.add(p.slug);
}

export const SEO_SLUGS: string[] = ALL_PAGES.map((p) => p.slug);

const BY_SLUG = new Map(ALL_PAGES.map((p) => [p.slug, p]));

export function getSeoPage(slug: string): SeoPage | undefined {
  return BY_SLUG.get(slug);
}

/** One canonical page per cluster — used for home/footer/cross-cluster links. */
export function getPrimaryPages(): SeoPage[] {
  return ALL_PAGES.filter((p) => p.isPrimary);
}

/** The canonical download page for a platform — used by platform cards. */
export function getPrimaryPageForPlatform(
  platformId: PlatformId,
): SeoPage | undefined {
  return (
    ALL_PAGES.find((p) => p.platformId === platformId && p.isPrimary) ??
    ALL_PAGES.find((p) => p.platformId === platformId)
  );
}

export function getClusterPages(clusterId: string): SeoPage[] {
  return ALL_PAGES.filter((p) => p.clusterId === clusterId);
}

/**
 * Internal-linking engine: for a given page return related links that build
 * crawl depth and topical authority — 5 same-cluster pages + 2 cross-cluster
 * primary pages. (Home is linked separately in the component.)
 */
export function getRelatedPages(slug: string): {
  sameCluster: SeoPage[];
  crossCluster: SeoPage[];
} {
  const page = getSeoPage(slug);
  if (!page) return { sameCluster: [], crossCluster: [] };
  const seed = hash(slug);

  const siblings = ALL_PAGES.filter(
    (p) => p.clusterId === page.clusterId && p.slug !== slug,
  );
  const sameCluster = rotate(siblings, seed, 5);

  const otherPrimaries = getPrimaryPages().filter(
    (p) => p.clusterId !== page.clusterId,
  );
  const crossCluster = rotate(otherPrimaries, seed, 2);

  return { sameCluster, crossCluster };
}

/** Shared 3-step "how to" used across pages. */
export function howToSteps(brand: string, thing: string) {
  return [
    {
      title: `Copy the ${brand} link`,
      text: `Open ${brand}, find the ${thing} you want, and copy its share link.`,
    },
    {
      title: "Paste it above",
      text: "Paste the link into the box and tap Download to fetch the media.",
    },
    {
      title: "Pick quality & save",
      text: "Choose video quality or MP3 audio — the file saves to your device.",
    },
  ];
}
