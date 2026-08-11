/**
 * "Why am I seeing this?" (Feature 15 · Part 4).
 *
 * ── The rule that makes an explanation trustworthy ────────────────────────
 * The reason is built from the SIGNALS THAT MADE THE PICK, handed over by
 * `ranking.ts`. It is never re-derived in a component from the props that
 * happen to be on screen. Part 3 established this for the comment-preview badge
 * and the failure mode is the same: a component guessing at "why" produces a
 * sentence that is plausible, unfalsifiable and sometimes false.
 *
 * ── Every string names something that exists ──────────────────────────────
 * A person who really reposted. A count of rows. A category the viewer really
 * engaged with. There is deliberately no "trending among people you follow"
 * string: no trend is computed anywhere in this codebase, and inventing one is
 * exactly the fabricated social proof this project has declined three times.
 * The `trending` kind is absent from the union rather than present-and-unused,
 * so a future caller cannot quietly start emitting it without adding it here.
 *
 * ── Emoji ─────────────────────────────────────────────────────────────────
 * Returned as its OWN field, never baked into the sentence. The brief's
 * examples carry emoji and notification copy has an owner-approved exception,
 * but chrome does not — so the surface decides, and the accessible name uses
 * `text` alone rather than reading a glyph aloud.
 *
 * Pure: no React, no Supabase, no I/O.
 */

import type { RepostSignal, RepostSignalKind } from "./ranking";

export type RepostReasonKind =
  | "close_friend"
  | "one_reposter"
  | "few_reposters"
  | "many_reposters"
  | "second_degree"
  | "shared_interest"
  | "followed";

export interface RepostReason {
  kind: RepostReasonKind;
  /** The one line shown on the item. Also the accessible name — no emoji in it. */
  text: string;
  /** The decorative glyph, for surfaces that want it. */
  emoji: string;
  /**
   * The longer answer, for the "Why am I seeing this?" sheet. Each entry is a
   * fact, in the order it influenced the decision.
   */
  detail: string[];
}

export interface ReasonInput {
  /** From `scoreRepost`, already sorted biggest-first. */
  signals: readonly RepostSignal[];
  /**
   * Display names of visible reposters, strongest tie first. May be shorter
   * than `reposterCount` — the caller only resolves the few it will name.
   */
  reposterNames: readonly string[];
  /** Distinct people the viewer can see who reposted this post. */
  reposterCount: number;
  /** Human label for the post's category, when interest overlap applies. */
  categoryLabel?: string | null;
}

const SPELLED = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "Five friends" reads as a sentence; "5 friends" reads as a metric. */
function spell(n: number): string {
  return (n >= 0 && n <= 10 ? SPELLED[n] : undefined) ?? String(n);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function topKind(signals: readonly RepostSignal[]): RepostSignalKind | null {
  return signals[0]?.kind ?? null;
}

/**
 * Build the explanation.
 *
 * The order of the branches is the priority order the brief asks for — friends
 * first, then corroboration, then the algorithm. A close friend's
 * recommendation is never described as "popular with people like you", even
 * when the interest score happened to be the larger number: the relationship is
 * the more useful and more honest thing to say.
 */
export function repostReason(input: ReasonInput): RepostReason | null {
  const { reposterNames, reposterCount } = input;
  const named = reposterNames[0];
  const detail = describeSignals(input);

  if (reposterCount <= 0 || !named) {
    // Nothing nameable and no corroboration: an interest match on its own is
    // the only honest thing left to say, and only if it actually fired.
    if (topKind(input.signals) === "shared_interest") {
      return {
        kind: "shared_interest",
        text: input.categoryLabel
          ? `Popular with people who watch ${input.categoryLabel}.`
          : "Popular with people who watch what you watch.",
        emoji: "⭐",
        detail,
      };
    }
    return null;
  }

  if (input.signals.some((s) => s.kind === "close_friend")) {
    return {
      kind: "close_friend",
      text:
        reposterCount > 1
          ? `${named} — one of your close friends — and ${spell(reposterCount - 1)} ${reposterCount === 2 ? "other" : "others"} reposted this.`
          : `${named} is one of your close friends, and reposted this.`,
      emoji: "💙",
      detail,
    };
  }

  if (reposterCount >= 5) {
    return {
      kind: "many_reposters",
      text: `${capitalise(spell(reposterCount))} people you follow reposted this.`,
      emoji: "🔥",
      detail,
    };
  }

  if (reposterCount > 1) {
    const others = reposterCount - 1;
    return {
      kind: "few_reposters",
      text: `${named} and ${spell(others)} ${others === 1 ? "other" : "others"} reposted this.`,
      emoji: "🔥",
      detail,
    };
  }

  if (input.signals.some((s) => s.kind === "second_degree")) {
    return {
      kind: "second_degree",
      text: `${named} reposted this after finding it through someone else.`,
      emoji: "👥",
      detail,
    };
  }

  return {
    kind: "one_reposter",
    text: `${named} reposted this.`,
    emoji: "💙",
    detail,
  };
}

/**
 * The long answer. One line per signal that actually contributed, in the order
 * it contributed — so the sheet shows the real weighting rather than a generic
 * "we use many factors" paragraph, which explains nothing.
 */
export function describeSignals(input: ReasonInput): string[] {
  const out: string[] = [];
  const named = input.reposterNames[0];
  for (const s of input.signals) {
    switch (s.kind) {
      case "close_friend":
        out.push(named ? `${named} is on your close friends list.` : "Someone on your close friends list reposted it.");
        break;
      case "strong_tie":
        out.push(named ? `You and ${named} interact often.` : "Someone you interact with often reposted it.");
        break;
      case "mutual_friends":
        out.push("You have friends in common with the person who reposted it.");
        break;
      case "many_reposters":
        out.push(`${input.reposterCount} people you follow reposted it independently.`);
        break;
      case "second_degree":
        out.push("It reached you by travelling through your network, not from the creator directly.");
        break;
      case "shared_interest":
        out.push(
          input.categoryLabel
            ? `You've engaged with ${input.categoryLabel} before.`
            : "It matches things you've engaged with before.",
        );
        break;
      case "recommended":
        out.push("The person who reposted it has a strong recommendation history.");
        break;
    }
  }
  // Always true, always worth saying: this is the promise the ranking makes.
  out.push("Your location is never used, and nobody is told that you saw this.");
  return out;
}
