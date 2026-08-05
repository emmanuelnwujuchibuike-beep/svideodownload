/**
 * Impersonation Protection™ — similarity detection (Feature 18 · Part 19).
 *
 * ── This is deterministic matching, and it says so ────────────────────────
 * The brief asks for "AI continuously monitors for copied profiles, stolen
 * photos, identity theft". What is honest to build is narrower and more
 * useful: exact, explainable string similarity over handles and display
 * names, with confusable characters folded first.
 *
 * That choice is not a shortcut. The realistic impersonation on a platform
 * this size is a lookalike handle — `emiIy` for `emily` (capital I), `emily_`,
 * `emi1y`, zero-width characters — and those are caught precisely by
 * normalisation plus edit distance, with no false confidence and no model to
 * mislabel someone's genuine account. Calling it AI would also invite trust it
 * has not earned: a member told "our AI detected identity theft" will believe
 * a false positive, and a false positive here is an accusation about a real
 * person.
 *
 * ── It NEVER acts. It reports, for a human to look at ─────────────────────
 * There is no auto-block, no auto-report, no notification to the accused. A
 * high score means "these two names are similar", which is not evidence of
 * anything on its own — plenty of real people share a name. The output is a
 * list the account owner reviews and, if they choose, reports through the
 * existing moderation flow.
 *
 * ── Stolen photos are deliberately out of scope ───────────────────────────
 * Detecting a copied avatar needs perceptual hashing over every image on the
 * platform: real infrastructure, real cost, and its own false-positive
 * problem. Claiming it in a settings screen while comparing only names would
 * tell members they are protected against something nobody is checking.
 *
 * Pure: no React, no Supabase, no I/O.
 */

/**
 * Characters that render alike. Folded before comparison so `emiIy` (capital
 * I) and `emi1y` both collapse onto `emily` — the substitutions an
 * impersonator actually uses, and the ones a member will never notice.
 */
const CONFUSABLES: Record<string, string> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "|": "l",
  "!": "l",
  "@": "a",
  $: "s",
  "¡": "l",
  ı: "l",
  ɩ: "l",
  ο: "o",
  о: "o",
  а: "a",
  е: "e",
  ѕ: "s",
  с: "c",
  р: "p",
  х: "x",
};

/**
 * Folds that only make sense BEFORE lowercasing.
 *
 * Capital `I` and lowercase `l` are the classic pair — indistinguishable in
 * most sans-serif faces, and the substitution behind `emiIy` for `emily`.
 *
 * Lowercase `i` is deliberately NOT in either table. An earlier version folded
 * it onto `l`, which lowercased first and therefore turned every legitimate
 * `i` into `l` — "emily" normalised to "emlly", so a name matched only its own
 * corruption. Lowercase `i` carries a dot; it is not a lookalike for `l`, and
 * folding it destroys the letter rather than the disguise.
 */
const CASE_SENSITIVE_CONFUSABLES: Record<string, string> = {
  I: "l",
  "İ": "l",
  Ι: "l", // Greek capital iota
  І: "l", // Cyrillic capital i
};

/**
 * Reduce a name to what it LOOKS like: lowercase, accents stripped, confusable
 * characters folded, separators and invisible characters removed.
 *
 * Aggressive on purpose. This function decides what counts as "the same
 * name at a glance", which is the only question that matters for
 * impersonation — a human scanning a notification does not read character by
 * character.
 */
export function normalizeName(raw: string): string {
  const decomposed = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  let out = "";
  // Iterated in the ORIGINAL case: the capital-I fold has to happen before
  // lowercasing, or it is indistinguishable from a legitimate lowercase i.
  for (const ch of decomposed) {
    const code = ch.codePointAt(0)!;
    // Drop invisibles, separators and punctuation entirely.
    if (code < 0x20 || (code >= 0x200b && code <= 0x200f) || code === 0xfeff) continue;
    if (/[\s._\-–—]/.test(ch)) continue;

    const cased = CASE_SENSITIVE_CONFUSABLES[ch];
    if (cased) {
      out += cased;
      continue;
    }
    const lower = ch.toLowerCase();
    out += CONFUSABLES[lower] ?? lower;
  }
  return out;
}

/** Levenshtein distance, iterative and allocation-light. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** 0–1, where 1 is identical after normalisation. */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  const longest = Math.max(x.length, y.length);
  return Math.max(0, 1 - editDistance(x, y) / longest);
}

export interface ImpersonationCandidate {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  followersCount: number;
  /** Days since the account was created, when known. */
  accountAgeDays: number | null;
}

export interface ImpersonationSubject {
  id: string;
  handle: string;
  displayName: string;
  isVerified: boolean;
  followersCount: number;
}

export interface ImpersonationMatch {
  candidate: ImpersonationCandidate;
  /** 0–100. Only ever a similarity measure, never a verdict. */
  score: number;
  /** Plain-language reasons, shown verbatim so the member can judge. */
  reasons: string[];
  /** Identical after folding — the case worth surfacing first. */
  exactLookalike: boolean;
}

/** Below this, two names are simply different people. */
export const MATCH_THRESHOLD = 0.8;

/**
 * Rank accounts that look like `subject`.
 *
 * Weighting reflects what an impersonator is actually after: the HANDLE is
 * what gets typed and linked, so a lookalike handle scores far above a shared
 * display name — thousands of real people share a display name, and flagging
 * them all would bury the one account that matters.
 *
 * A brand-new account with almost no followers is the classic shape, so it
 * lifts the score. It is a signal, never a verdict: plenty of new accounts are
 * simply new.
 */
export function findImpersonators(
  subject: ImpersonationSubject,
  candidates: readonly ImpersonationCandidate[],
): ImpersonationMatch[] {
  const matches: ImpersonationMatch[] = [];

  for (const c of candidates) {
    if (c.id === subject.id) continue;

    const handleScore = similarity(subject.handle, c.handle);
    const nameScore = similarity(subject.displayName, c.displayName);
    if (handleScore < MATCH_THRESHOLD && nameScore < MATCH_THRESHOLD) continue;

    const reasons: string[] = [];
    let score = 0;

    if (handleScore >= 0.99) {
      score += 60;
      reasons.push("Their username looks identical to yours");
    } else if (handleScore >= MATCH_THRESHOLD) {
      score += Math.round(handleScore * 45);
      reasons.push("Their username is nearly the same as yours");
    }

    if (nameScore >= 0.99) {
      score += 25;
      reasons.push("Their display name is the same as yours");
    } else if (nameScore >= MATCH_THRESHOLD) {
      score += Math.round(nameScore * 18);
      reasons.push("Their display name is very close to yours");
    }

    if (c.accountAgeDays != null && c.accountAgeDays < 30) {
      score += 10;
      reasons.push("The account is less than a month old");
    }
    // A near-empty account wearing your name is the classic shape.
    if (c.followersCount < 10 && subject.followersCount >= 50) {
      score += 5;
      reasons.push("It has very few followers compared with yours");
    }
    // A verified account is overwhelmingly likely to be a real, different
    // person who happens to share a name.
    if (c.isVerified) {
      score -= 25;
      reasons.push("This account is verified, so it is probably a different real person");
    }

    matches.push({
      candidate: c,
      score: Math.max(0, Math.min(100, score)),
      reasons,
      exactLookalike: handleScore >= 0.99,
    });
  }

  return matches
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.handle.localeCompare(b.candidate.handle));
}

/**
 * Handles worth querying for, given a member's own handle.
 *
 * The scan cannot compare against every account on the platform, so this
 * generates the small set of shapes an impersonator actually registers. It is
 * a prefix/suffix net, not a guarantee — which is exactly why the UI calls
 * this a check the member can run, not continuous protection.
 */
export function lookalikePatterns(handle: string): string[] {
  const base = normalizeName(handle);
  if (!base) return [];
  const out = new Set<string>([base]);
  // The overwhelmingly common shapes: something appended, or a separator.
  for (const suffix of ["1", "0", "_", ".", "official", "real", "hq", "backup"]) {
    out.add(`${base}${suffix}`);
  }
  for (const prefix of ["the", "real", "official", "im", "its"]) {
    out.add(`${prefix}${base}`);
  }
  return [...out];
}
