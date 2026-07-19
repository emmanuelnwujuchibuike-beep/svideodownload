import { HELP_SECTIONS, type SupportSection } from "./types";

/**
 * Section presentation metadata.
 *
 * Kept out of `articles.ts` so the article corpus stays pure content, and out of
 * the page components so both centres and the search index describe a section
 * identically.
 *
 * Icons are NAMED, not imported, so this module stays render-free and can be
 * pulled into non-React consumers (search index, JSON-LD, admin) without dragging
 * an icon library along.
 */
export interface SectionMeta {
  id: SupportSection;
  name: string;
  /** Shown under the heading — what this area answers. */
  blurb: string;
  icon: string;
  order: number;
}

export const SECTIONS: Record<SupportSection, SectionMeta> = {
  security: {
    id: "security",
    name: "Security",
    blurb: "How your account is protected, and how to report a problem you find.",
    icon: "ShieldCheck",
    order: 1,
  },
  privacy: {
    id: "privacy",
    name: "Privacy",
    blurb: "What is visible to whom, and how to take your data with you or delete it.",
    icon: "Lock",
    order: 2,
  },
  safety: {
    id: "safety",
    name: "Safety",
    blurb: "Blocking, reporting, appeals, and the limits on what can be saved.",
    icon: "Users",
    order: 3,
  },
  transparency: {
    id: "transparency",
    name: "Transparency",
    blurb: "Who operates Frenzsave, and what we will and will not claim.",
    icon: "Eye",
    order: 4,
  },
  "getting-started": {
    id: "getting-started",
    name: "Getting started",
    blurb: "The basics, end to end.",
    icon: "Compass",
    order: 5,
  },
  troubleshooting: {
    id: "troubleshooting",
    name: "Troubleshooting",
    blurb: "When something does not work as expected.",
    icon: "Wrench",
    order: 6,
  },
};

export function sectionMeta(id: SupportSection): SectionMeta {
  return SECTIONS[id];
}

/* ----------------------------------- centres ---------------------------------- */

/**
 * The two views over the corpus.
 *
 * A section belongs to exactly one centre, and that mapping is what decides an
 * article's URL, its breadcrumb, its metadata title and which index page lists
 * it. Deriving all four from one record is what stops them drifting into
 * disagreement — a breadcrumb saying "Trust Center" above a page living at /help
 * is the kind of thing nobody notices for months.
 */
export interface CentreMeta {
  id: "help" | "trust";
  name: string;
  href: string;
}

export const CENTRES: Record<CentreMeta["id"], CentreMeta> = {
  help: { id: "help", name: "Help Center", href: "/help" },
  trust: { id: "trust", name: "Trust Center", href: "/trust" },
};

export function centreOf(section: SupportSection): CentreMeta {
  return HELP_SECTIONS.includes(section) ? CENTRES.help : CENTRES.trust;
}
