import { availabilityOfProduct, type Availability } from "@/lib/platform/availability";

import type { School, SchoolId, SchoolView } from "./types";

/**
 * The Knowledge Campus™ registry — metadata only.
 *
 * ── Bundle discipline (load-bearing, not stylistic) ───────────────────────────
 *
 * This module must never import lesson prose. `lib/learning` already learned this
 * the expensive way: importing lesson TITLES for a three-item rail pulled every
 * word of every lesson into `/downloads`, ~10 kB of text nobody was going to read
 * there. The Academy corpus is an order of magnitude larger. Metadata modules and
 * body modules stay separate, and `academy.test.ts` pins it.
 *
 * ── Why all eleven schools are declared ───────────────────────────────────────
 *
 * Six of the briefed schools teach products that do not exist yet. The resolution
 * is the one the Download Hub established and the owner approved: DECLARE
 * everything, DERIVE availability from the Product Genome, and let tense follow
 * availability. A visitor sees the whole campus and an honest account of what is
 * ready. When a product ships, its school lights up with no code change here.
 *
 * ── The two axes ──────────────────────────────────────────────────────────────
 *
 * `kind` is the part that took a second attempt to get right. A school teaching a
 * PRODUCT can only have lessons if the product exists. A school teaching a
 * PRACTICE — editing craft, security hygiene — is true regardless of what we ship,
 * so it publishes freely. Without that split, Editing School™ either claims an
 * editor we do not ship or refuses to publish genuinely useful editing knowledge.
 */
export const SCHOOLS: School[] = [
  {
    id: "creator",
    slug: "creator",
    name: "Creator School",
    tagline: "Save, make and publish media people actually watch.",
    summary:
      "The full creator loop on Frenzsave: bringing media in, keeping its quality, captioning it properly, and publishing it as posts, reels and stories.",
    kind: "product",
    productId: "download",
    order: 1,
    icon: "Clapperboard",
  },
  {
    id: "community",
    slug: "community",
    name: "Community School",
    tagline: "Build a feed, a friend list and a group worth being in.",
    summary:
      "How the social side of Frenzsave works — feeds, friends, messaging, stories and reshares — and how to run a space that stays healthy as it grows.",
    kind: "product",
    productId: "community",
    order: 2,
    icon: "Users",
  },
  {
    id: "editing",
    slug: "editing",
    name: "Editing School",
    /*
     * PRACTICE, not product. Frenzsave does not ship a video editor, and this
     * school must never imply one. It teaches the craft — trimming, cropping,
     * generation loss, thumbnails — which is true of any editor the reader uses.
     * `lib/learning` already has real, honest lessons of exactly this kind.
     */
    tagline: "Cut, crop and export without quietly destroying your footage.",
    summary:
      "Editing craft that applies wherever you edit: trimming, aspect ratios, the generation-loss trap in re-encoded video, and thumbnails that read at the size people see them.",
    kind: "practice",
    productId: null,
    order: 3,
    icon: "Scissors",
  },
  {
    id: "security",
    slug: "security-privacy",
    name: "Security & Privacy School",
    tagline: "Understand what is public, what is private, and who can reach you.",
    summary:
      "Account security, privacy controls, hidden accounts, blocking and restrictions — what each setting actually changes about who can see and contact you.",
    kind: "practice",
    productId: null,
    order: 4,
    icon: "ShieldCheck",
  },
  {
    id: "developer",
    slug: "developer",
    name: "Developer School",
    tagline: "Build on Frenzsave.",
    summary:
      "Working against the Frenzsave platform: the SDK, API surface, authentication, rate limits and the integration patterns that hold up in production.",
    kind: "product",
    productId: "developer-platform",
    order: 5,
    icon: "Code2",
  },
  {
    id: "business",
    slug: "business",
    name: "Business School",
    tagline: "Grow an audience and a brand on Frenzsave.",
    summary:
      "Running Frenzsave as a business: brand presence, audience growth, content operations and measuring what actually works.",
    kind: "product",
    productId: "business",
    order: 6,
    icon: "Briefcase",
  },
  {
    id: "marketplace",
    slug: "marketplace",
    name: "Marketplace School",
    tagline: "Sell, buy and deliver work.",
    summary:
      "Listing and selling on the Frenzsave Marketplace: pricing, delivery, buyer trust and the operational side of running a storefront.",
    kind: "product",
    productId: "marketplace",
    order: 7,
    icon: "Store",
  },
  {
    id: "ai",
    slug: "ai",
    name: "AI School",
    tagline: "Create with AI Studio.",
    summary:
      "Using AI Studio for generation, enhancement and assisted editing — including where AI genuinely helps and where it does not.",
    kind: "product",
    productId: "studio",
    order: 8,
    icon: "Sparkles",
  },
  {
    id: "cloud",
    slug: "cloud",
    name: "Cloud School",
    tagline: "Store, sync and share a media library.",
    summary:
      "Keeping a media library in Frenzsave Cloud: organisation, syncing across devices, sharing, and what happens to storage as a library grows.",
    kind: "product",
    productId: "cloud",
    order: 9,
    icon: "CloudUpload",
  },
  {
    id: "professional",
    slug: "professional",
    name: "Professional School",
    tagline: "Build a professional presence and network.",
    summary:
      "Professional Workspace: profiles, portfolios, networking and presenting work to clients and collaborators.",
    kind: "product",
    productId: "professional",
    order: 10,
    icon: "BriefcaseBusiness",
  },
  {
    id: "enterprise",
    slug: "enterprise",
    name: "Enterprise School",
    tagline: "Deploy Frenzsave across an organisation.",
    summary:
      "Enterprise deployment: administration, roles and permissions, governance, compliance and scaling Frenzsave across teams.",
    kind: "product",
    productId: "enterprise",
    order: 11,
    icon: "Building2",
  },
];

/**
 * Schools that are genuinely built but are CONTENT or PLATFORM surfaces rather
 * than Product Genome modules, so `getModule()` will never find them.
 *
 * This is an allowlist and it is dangerous by nature — an id in here is asserted
 * real without the Genome vouching for it. `academy.test.ts` therefore proves every
 * entry resolves to a route that exists on disk. Without that proof, a typo would
 * silently promote an unbuilt school to "live", which is the exact failure the
 * fail-closed default exists to prevent.
 */
export const CORE_LIVE_SCHOOL_PRODUCTS: ReadonlyMap<string, string> = new Map([
  // productId → the route that PROVES it exists. Checked on disk by the test.
  ["developer-platform", "/developers"],
]);

const CORE_LIVE_IDS: ReadonlySet<string> = new Set(CORE_LIVE_SCHOOL_PRODUCTS.keys());

/* --------------------------------- derivation -------------------------------- */

/**
 * Availability of a school.
 *
 * A PRACTICE school is always `live`: it teaches a subject, and a subject does not
 * need us to have shipped anything. A PRODUCT school inherits its product's state
 * from the Genome, failing closed to `planned` for an unknown id.
 */
export function schoolAvailability(school: School): Availability {
  if (school.kind === "practice") return "live";
  if (!school.productId) return "planned";
  return availabilityOfProduct(school.productId, CORE_LIVE_IDS);
}

/**
 * Whether lesson BODIES may exist for this school — the Reality Ledger gate.
 *
 * Declaring a school is a statement of direction. Writing a lesson is a statement
 * of fact about how software behaves. Only the second one can be false, so only the
 * second one is gated.
 */
export function isTeachable(school: School): boolean {
  return schoolAvailability(school) !== "planned";
}

/** A school joined to everything derived from it. The shape surfaces render. */
export function toView(school: School): SchoolView {
  return {
    ...school,
    availability: schoolAvailability(school),
    teachable: isTeachable(school),
  };
}

/* ----------------------------------- reads ----------------------------------- */

const BY_ID = new Map(SCHOOLS.map((s) => [s.id, s]));
const BY_SLUG = new Map(SCHOOLS.map((s) => [s.slug, s]));

export const SCHOOL_SLUGS: string[] = SCHOOLS.map((s) => s.slug);

export function getSchool(id: SchoolId): School | undefined {
  return BY_ID.get(id);
}

export function getSchoolBySlug(slug: string): School | undefined {
  return BY_SLUG.get(slug);
}

/** Every school, ordered — including planned ones, which render honestly. */
export function schoolViews(): SchoolView[] {
  return [...SCHOOLS].sort((a, b) => a.order - b.order).map(toView);
}

/** Only schools whose lessons may exist. Sitemaps and search index read this. */
export function teachableSchools(): SchoolView[] {
  return schoolViews().filter((s) => s.teachable);
}
