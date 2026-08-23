import { CLUSTERS, type SeoCluster, type SeoModifier } from "@/config/seoPages";
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

  const title = f(modifier.title);
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
  const intro = f(cluster.intros[seed % cluster.intros.length]!);
  const facts = rotate(cluster.facts, seed, 2).map(f);
  const about = [intro, f(modifier.angle), ...facts];

  const benefits = [
    { title: f(modifier.benefit.title), text: f(modifier.benefit.text) },
    ...cluster.baseBenefits,
  ];

  const faqs = [
    ...modifier.faqs.map((q) => ({ q: f(q.q), a: f(q.a) })),
    ...rotate(cluster.baseFaqs, seed, 3),
  ];

  const description = truncate(
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
