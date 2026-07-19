/**
 * Support & Trust content types — the shared substrate behind the Help Center
 * and the Trust Center.
 *
 * ── Why one substrate and not two ─────────────────────────────────────────────
 *
 * The Academy brief asks for a Help Center; the Trust brief asks for a Trust
 * Center with Security, Privacy, Safety and Transparency areas. Modelled
 * separately, those are two article systems with two editorial queues, two search
 * indexes and two admin screens — and the boundary between them is genuinely
 * blurry ("who can see my profile" is simultaneously a help article and a privacy
 * article).
 *
 * So there is one article type with a `section` discriminator. The Help Center and
 * the Trust Center are two VIEWS over it, exactly as the Academy is a view over
 * the lesson corpus rather than a copy of it.
 *
 * ── Relationship to lessons ───────────────────────────────────────────────────
 *
 * Deliberately a separate type from `Lesson`. A lesson teaches a skill and belongs
 * to a curriculum with an order and outcomes; a support article answers one
 * question and is arrived at from search or a link. Forcing them into one shape
 * would mean every article carrying meaningless curriculum fields.
 */

export type SupportSection =
  /* Help Center */
  | "getting-started"
  | "troubleshooting"
  /* Trust Center */
  | "security"
  | "privacy"
  | "safety"
  | "transparency";

/** Which centre a section is rendered under. */
export const TRUST_SECTIONS: readonly SupportSection[] = [
  "security",
  "privacy",
  "safety",
  "transparency",
];

export const HELP_SECTIONS: readonly SupportSection[] = ["getting-started", "troubleshooting"];

export interface SupportBlock {
  heading: string;
  body: string[];
  /** Optional ordered steps, rendered as a list and as HowTo JSON-LD. */
  steps?: { title: string; text: string }[];
}

export interface SupportArticle {
  slug: string;
  title: string;
  /** Meta description and card subtitle. Under ~158 chars. */
  description: string;
  section: SupportSection;
  /**
   * Plain-language summary, required.
   *
   * The Trust brief asks for "plain-language summaries" as an accessibility
   * requirement, and it is the right call: trust content is exactly where people
   * skim and then act on a half-understanding. Making it non-optional means no
   * article can quietly ship without one.
   */
  summary: string;
  blocks: SupportBlock[];
  faqs?: { q: string; a: string }[];
  /** Related article slugs — the internal-linking graph. */
  related: string[];
  /**
   * Formal policy this article explains, if any.
   *
   * Trust articles EXPLAIN; they never REPLACE. The policy remains authoritative,
   * and every plain-language article that summarises one must link to it — the
   * summary is a reading aid, not a substitute, and presenting it as the latter
   * would be its own kind of dishonesty.
   */
  policyHref?: string;
}

/* --------------------------------- glossary ---------------------------------- */

export interface GlossaryTerm {
  slug: string;
  term: string;
  /** One or two sentences. Plain language, no jargon defined by more jargon. */
  definition: string;
  /** Alternate names people actually search for. Feeds the search index. */
  aliases: string[];
  /** Related term slugs. */
  related: string[];
}
