import { coursesForSchool } from "@/lib/academy/courses";
import { teachableSchools } from "@/lib/academy/schools";
import { claimableProducts, unclaimableProducts } from "@/lib/content/reality-ledger";
import { LESSON_CATALOG } from "@/lib/learning/catalog";
import { SHOWCASE_PLATFORMS } from "@/lib/platforms";
import { SUPPORT_ARTICLES, articleHref } from "@/lib/support/articles";
import { GLOSSARY } from "@/lib/support/glossary";

/**
 * Generated facts for Frenz Assistant.
 *
 * ── The drift problem this solves ─────────────────────────────────────────────
 *
 * `ASSISTANT_SYSTEM_PROMPT` was one hand-maintained string listing supported
 * platforms, what the product does, and what to say when something fails. Its own
 * header called itself "the single source of truth" — but so is the platform
 * registry, and so is the Product Genome, and they disagree the moment either
 * side changes.
 *
 * That is not hypothetical. The Download tagline claimed "20+ platforms" against
 * a real 11 for long enough to reach production, and the assistant prompt is
 * exactly the kind of file where such a number goes stale unnoticed — nobody
 * re-reads a system prompt. Meanwhile an Academy, a Trust Center and a glossary
 * now exist that the prompt has never heard of, so the bot would confidently
 * answer questions our own documentation answers differently.
 *
 * ── What is generated and what stays authored ─────────────────────────────────
 *
 * FACTS are generated here: platforms, products, guides, trust topics, glossary.
 * These have a source of truth elsewhere and must never be retyped.
 *
 * PERSONA, TONE and BOUNDARIES stay hand-written in `knowledge.ts`. Those are
 * editorial judgement with no upstream to derive from, and generating them would
 * be cargo-culting the pattern past the point where it helps.
 *
 * ── Why unbuilt products are named explicitly ─────────────────────────────────
 *
 * The prompt does not merely omit them. Omission leaves the model free to
 * improvise when a user asks "does Frenzsave have cloud storage?" — and a model
 * asked about a plausible-sounding feature will often say yes. Listing them as
 * NOT built converts a silence the model would fill into an instruction it can
 * follow.
 */

function bullet(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

/** Supported platforms, from the registry rather than a retyped list. */
export function platformFacts(): string {
  return SHOWCASE_PLATFORMS.map((p) => p.name).join(", ");
}

/** Products, split by whether they exist. Both halves matter. */
export function productFacts(): string {
  const live = claimableProducts();
  const unbuilt = unclaimableProducts().filter((p) => p.id !== "admin");

  const sections = [
    `## Products that EXIST today\n${bullet(live.map((p) => `**${p.name}** (${p.basePath}): ${p.tagline}`))}`,
  ];

  if (unbuilt.length > 0) {
    sections.push(
      `## Products that DO NOT EXIST yet\n` +
        `These are planned and NOT usable. If asked, say they are not available yet. ` +
        `Never describe how to use them, and never imply a release date.\n` +
        bullet(unbuilt.map((p) => p.name)),
    );
  }

  return sections.join("\n\n");
}

/** Learning corpus — so the assistant can point at a real guide. */
export function learningFacts(): string {
  const schools = teachableSchools().map((s) => {
    const courses = coursesForSchool(s.id).map((c) => c.title).join("; ");
    return `**${s.name}** (/academy/${s.slug}) — ${courses}`;
  });

  const lessons = LESSON_CATALOG.map((l) => `${l.title} (/learn/${l.slug})`);

  return (
    `## Learning\nWhen a question is better answered by a guide, link to it.\n\n` +
    `### Schools\n${bullet(schools)}\n\n### Guides\n${bullet(lessons)}`
  );
}

/**
 * Support topics — the questions where being wrong matters most.
 *
 * The href is derived, never written here. An assistant that confidently cites
 * `/trust/saving-your-first-video` sends people to a 404 in the one moment they
 * are already stuck, and it does it in a voice that sounds authoritative.
 */
export function supportFacts(): string {
  const articles = SUPPORT_ARTICLES.map(
    (a) => `${a.title} (${articleHref(a)}) — ${a.summary}`,
  );

  return (
    `## Help, security, privacy and safety\n` +
    `These summaries are authoritative. Do NOT improvise on how downloading ` +
    `works, account security, privacy or deletion — quote these and link to the ` +
    `article.\n` +
    bullet(articles)
  );
}

/** Glossary — definitions the assistant should reuse rather than reinvent. */
export function glossaryFacts(): string {
  return `## Terms\n${bullet(GLOSSARY.map((t) => `**${t.term}**: ${t.definition}`))}`;
}

/**
 * The full generated block, injected into the system prompt.
 *
 * Composed at module load from static data, so it costs nothing per request and
 * cannot go stale between deploys.
 */
export function generatedFacts(): string {
  return [
    `# Supported platforms (and ONLY these)\n${platformFacts()}\n` +
      `If asked about a site outside this list, say it is not currently supported.`,
    productFacts(),
    learningFacts(),
    supportFacts(),
    glossaryFacts(),
  ].join("\n\n");
}
