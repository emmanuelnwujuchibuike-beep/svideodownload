/**
 * The Reality Ledger — Phase 1 of the Living Content Platform.
 * See `docs/LIVING_CONTENT_PLATFORM_RFC.md` §3.
 *
 * Purpose: make it mechanically impossible to ship marketing copy that claims a
 * product exists when it doesn't, or that states a magnitude nobody can source.
 *
 * This is a truth gate, not a style rule. Both failure modes have already shipped
 * to production on this site:
 *   - products spec'd and marketed that were never built (16 of 25, landing Part 1);
 *   - `stats-counter.tsx` animating "35,000,000+ videos downloaded" and
 *     "8,000,000+ community members", both overstated by four to five orders of
 *     magnitude against the real table counts.
 *
 * The enforcement lives in `reality-ledger.test.ts`, which runs in CI.
 *
 * Pure functions over typed data, no I/O — per the RFC this belongs to the
 * "Content Core" boundary and must stay callable from the content compiler.
 */
import { getModules } from "@/lib/platform/modules";
import type { PlatformModule } from "@/lib/platform/module-registry";

/* ------------------------------- genome queries ------------------------------ */

/** Products marketing may state, in the present tense, that we have. */
export function claimableProducts(): PlatformModule[] {
  return getModules().filter((m) => m.veracity.claimable);
}

/** Products that must only ever be described in future/conditional tense. */
export function unclaimableProducts(): PlatformModule[] {
  return getModules().filter((m) => !m.veracity.claimable);
}

/** Whether a given product id may be presented as existing today. */
export function isClaimable(id: string): boolean {
  return getModules().find((m) => m.id === id)?.veracity.claimable ?? false;
}

/**
 * Records a human hasn't re-confirmed within `days`. Drift accumulates silently;
 * the Sync Engine (RFC §6) will consume this, and until then it's a review queue.
 */
export function staleVeracity(days = 90, now = new Date()): PlatformModule[] {
  const cutoff = now.getTime() - days * 864e5;
  return getModules().filter((m) => {
    const at = m.veracity.verifiedAt;
    return !at || Number.isNaN(Date.parse(at)) || Date.parse(at) < cutoff;
  });
}

/* ------------------------------- claim scanning ------------------------------ */

/**
 * Unsourced SOCIAL-PROOF claims, e.g. "35,000,000+ videos downloaded",
 * "8M+ community members", "120+ countries", "99.9% success rate".
 *
 * We cannot verify a number's truth from source alone, so the rule is narrower and
 * checkable: a figure presented to users as evidence of SCALE or ACHIEVEMENT must
 * not be a bare literal in a component. It has to come from a sourced module that
 * can be audited (a real query, or an explicitly-documented illustrative constant
 * like `showcase-stats.ts`).
 *
 * Scoping this to social proof rather than "any big number" is deliberate. The first
 * cut flagged 21 sites, of which 19 were noise:
 *   - CSS colour values (`rgba(255,255,255,0.35)`) and Tailwind arbitrary values;
 *   - real plan quotas ("10,000 requests/day", "Up to 1,000 downloads/day"), which
 *     are product SPECS, verifiable against billing config, not claims about us.
 * A gate that cries wolf gets deleted, so it only fires on the shape that actually
 * carries risk: a number offered as proof of how big or how good we are.
 */

/** Nouns that turn a number into a claim about our scale or track record. */
const SOCIAL_PROOF =
  /\b(?:users|members|downloads?|videos?|creators?|customers?|people|countries|subscribers?|views|likes|installs?|ratings?|reviews?|businesses|communities|success rate|uptime|satisfaction)\b/i;

/** Rate limits and quotas: product specs, not social proof. */
const QUOTA = /\b(?:per\s+(?:day|month|hour|week)|\/\s*(?:day|month|hour|week)|up to|limit|quota|requests?)\b/i;

/**
 * Any figure a reader would parse as a quantity — including WORDED magnitudes.
 *
 * The digit-only version of this pattern shipped and then missed two live claims:
 * "Join Millions Using Frenz" (`cta-banner.tsx`) and "Join millions of people
 * already on Frenz" (`meet-people.tsx`), both against a real profile count in the
 * dozens. A reader draws exactly the same inference from "millions" as from
 * "8,000,000+", so the gate has to treat them the same. Requiring digits was an
 * implementation detail leaking into the policy.
 */
const FIGURE = /\b\d{1,3}(?:[,_]\d{3})+\+?|\b\d+(?:\.\d+)?\s*(?:million|billion|[MBK])\+|\b\d+(?:\.\d+)?\s*%|\b\d{2,}\+/gi;

/**
 * Worded magnitudes, which are a claim ON THEIR OWN.
 *
 * A digit needs a companion noun to be distinguishable from styling or a quota, but
 * "millions" is never anything except a scale claim — and requiring a noun let
 * "Join Millions Using Frenz" through, because the line says "Using", not "users".
 * Chasing that with more nouns is the wrong fix; the magnitude word is the claim.
 */
const WORDED_MAGNITUDE = /\b(?:millions?|billions?|thousands?|hundreds)\b/gi;

/** Remove CSS colour functions and Tailwind arbitrary values before scanning. */
function stripStyling(line: string): string {
  return line.replace(/\b(?:rgba?|hsla?)\([^)]*\)/gi, "").replace(/\[[^\]]*\]/g, "");
}

/**
 * Remove comment text before scanning. Comments are not user-facing copy, and
 * documenting a past violation must not itself trip the gate — the first version
 * of this file flagged its own changelog, which would have taught authors to stop
 * writing down why a number was wrong. The `//` strip skips `https://`.
 */
function stripComments(line: string): string {
  if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) return "";
  return line.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/, "$1");
}

/** Opt-out marker for a literal that is genuinely sourced or documented. */
export const SOURCED_MARKER = "@sourced";

export interface MagnitudeClaim {
  file: string;
  line: number;
  text: string;
  snippet: string;
}

/**
 * Scan source text for unsourced magnitude claims.
 *
 * A line is exempt when it, or the line above it, carries `@sourced` — which forces
 * the author to state where a number came from, in the diff, where review sees it.
 */
export function findMagnitudeClaims(file: string, source: string): MagnitudeClaim[] {
  const lines = source.split(/\r?\n/);
  const out: MagnitudeClaim[] = [];

  /*
   * Block-comment state has to be tracked ACROSS lines. A line-local check cannot
   * tell that an interior line of a `{/* … *\/}` JSX comment is commentary — which
   * is how a comment explaining a removed "Millions" claim tripped the gate it was
   * documenting. Middle lines carry no `//` or leading `*` marker of their own.
   */
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const prev = lines[i - 1] ?? "";

    const opens = line.lastIndexOf("/*");
    const closes = line.lastIndexOf("*/");
    const wasInBlock = inBlock;
    if (!inBlock && opens !== -1 && closes < opens) inBlock = true;
    else if (inBlock && closes !== -1 && closes > opens) inBlock = false;
    if (wasInBlock || inBlock) continue;

    if (line.includes(SOURCED_MARKER) || prev.includes(SOURCED_MARKER)) continue;

    // Skip imports and pure type positions — no user ever reads these.
    if (/^\s*import\s/.test(line)) continue;

    const clean = stripStyling(stripComments(line));
    if (QUOTA.test(clean)) continue; // a plan limit is a spec, not social proof

    // A worded magnitude is a scale claim by itself.
    for (const match of clean.matchAll(WORDED_MAGNITUDE)) {
      out.push({ file, line: i + 1, text: match[0].trim(), snippet: line.trim() });
    }

    // A digit only becomes a claim next to something it could be counting —
    // otherwise it is a z-index, a duration or a colour channel.
    if (!SOCIAL_PROOF.test(clean)) continue;
    for (const match of clean.matchAll(FIGURE)) {
      out.push({ file, line: i + 1, text: match[0].trim(), snippet: line.trim() });
    }
  }
  return out;
}

/* ----------------------------- tense enforcement ----------------------------- */

/** Present-tense verbs that assert existence. */
const PRESENT_TENSE = /\b(?:lets you|now available|is here|available now|get started with|try it now|start using)\b/i;

/**
 * Copy that presents an unclaimable product as existing.
 * Matches a product's display name near a present-tense existence claim.
 */
export function findFalseExistenceClaims(
  file: string,
  source: string,
): { file: string; line: number; product: string; snippet: string }[] {
  const banned = unclaimableProducts();
  const lines = source.split(/\r?\n/);
  const out: { file: string; line: number; product: string; snippet: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.includes(SOURCED_MARKER)) continue;
    if (!PRESENT_TENSE.test(line)) continue;

    for (const p of banned) {
      if (line.includes(p.name) || new RegExp(`\\bFrenzsave ${p.shortName}\\b`).test(line)) {
        out.push({ file, line: i + 1, product: p.name, snippet: line.trim() });
      }
    }
  }
  return out;
}
