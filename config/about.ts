/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO RUNS FRENZSAVE — the /about page's "Who we are" (owner: fill this in)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Moved out of app/(marketing)/about/page.tsx (2026-10-30, code review): the page printed "[Company/owner name]",
 * "[Country/city]" and "[Year founded]" to every visitor and reviewer while these were unfilled. Truth rule
 * (AGENTS.md): a real value or nothing. A line of "Who we are" now appears only when the value it names is filled in;
 * while every value is still a placeholder the whole section is left out, and the page's description stops
 * promising "who runs Frenzsave".
 *
 *   company    — the legal name, or the owner's name, that runs the site.
 *   location   — country and/or city.
 *   founded    — the year building started (for example "2025").
 *   founder    — the founder's name.
 *   founderBio — one or two sentences: who they are and why they built Frenzsave.
 *
 * Leave a value in [brackets] (or "") until it is real.
 */
export interface SiteOwner {
  company: string;
  location: string;
  founded: string;
  founder: string;
  founderBio: string;
}

export const SITE_OWNER: SiteOwner = {
  company: "[Company/owner name]",
  location: "[Country/city]",
  founded: "[Year founded]",
  founder: "[Founder name]",
  founderBio: "[Short founder bio — one or two sentences about who they are and why they built Frenzsave.]",
};

/** A real value: not empty, and not still its [placeholder]. */
export function isFilledIn(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && !/^\[.*\]$/.test(v);
}

export interface AboutOwnerLines {
  /** "Frenzsave is run by …, based in …, and has been building since …." — only the parts that are filled in. */
  runBy: string | null;
  founder: { name: string; bio: string | null } | null;
}

/** What "Who we are" can say truthfully. Both null → the section is left out. */
export function aboutOwnerLines(owner: SiteOwner = SITE_OWNER): AboutOwnerLines {
  const company = isFilledIn(owner.company) ? owner.company.trim() : null;
  const location = isFilledIn(owner.location) ? owner.location.trim() : null;
  const founded = isFilledIn(owner.founded) ? owner.founded.trim() : null;
  const who = company ? `is run by ${company}${location ? `, based in ${location}` : ""}` : location ? `is based in ${location}` : null;
  const since = founded ? `has been building since ${founded}` : null;
  const clauses = [who, since].filter((c): c is string => !!c);
  const name = isFilledIn(owner.founder) ? owner.founder.trim() : null;
  return {
    runBy: clauses.length ? `Frenzsave ${clauses.join(", and ")}.` : null,
    founder: name ? { name, bio: isFilledIn(owner.founderBio) ? owner.founderBio.trim() : null } : null,
  };
}
