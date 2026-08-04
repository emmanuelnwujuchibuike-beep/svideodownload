/**
 * Relationship timeline — derived, never stored (Feature 18 · Part 17).
 *
 * ── Why there is no milestones table ──────────────────────────────────────
 * Every milestone the platform can honestly show is already a timestamp on a
 * row it owns: `friendships.created_at` is "friends since",
 * `follows.created_at` is "following since", the first message in a
 * conversation is "first conversation". A milestones table would copy those
 * values to a second place, need a backfill for every existing relationship,
 * and then be wrong the first time a friendship is removed and remade.
 *
 * So milestones are computed at read time from facts that already exist. The
 * cost is a couple of small queries; the benefit is that the timeline cannot
 * drift from reality, and unfriending someone erases their timeline with them
 * rather than leaving an orphaned record of a relationship that ended.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 * The brief also names "first collaboration", "shared communities" and
 * "shared memories". None of those exist as data — there are no co-authored
 * posts, no communities table, and no shared album. Generating them from
 * something adjacent ("you both liked this") would be a fabricated memory
 * presented as a fact about a real relationship. They are absent until the
 * tables behind them are real.
 *
 * All dates are handled in UTC so a timeline does not shift when a member
 * travels, and so the tests are deterministic.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type MilestoneKind = "friends_since" | "following_since" | "first_message" | "anniversary";

export interface Milestone {
  kind: MilestoneKind;
  /** ISO date the milestone happened (or will happen, for an anniversary). */
  at: string;
  title: string;
  /** Set on anniversaries. */
  years?: number;
}

export interface TimelineInput {
  /** ISO timestamp the friendship began, if they are friends. */
  friendsSince?: string | null;
  /** ISO timestamp the viewer started following, if they do. */
  followingSince?: string | null;
  /** ISO timestamp of the first message in their conversation. */
  firstMessageAt?: string | null;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The same calendar day in a later year, in UTC.
 *
 * 29 February is the case that breaks naive implementations: `setUTCFullYear`
 * on a non-leap year rolls it to 1 March, so a friendship made on a leap day
 * would celebrate its anniversary a day late in three years out of four. It is
 * pinned to 28 February instead, which is the convention every calendar app
 * that gets this right uses.
 */
export function anniversaryDate(since: Date, year: number): Date {
  const month = since.getUTCMonth();
  const day = since.getUTCDate();
  const isLeapTarget = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const safeDay = month === 1 && day === 29 && !isLeapTarget ? 28 : day;
  return new Date(Date.UTC(year, month, safeDay, 0, 0, 0));
}

/** Whole years between two dates, UTC, never negative. */
export function yearsBetween(since: Date, now: Date): number {
  let years = now.getUTCFullYear() - since.getUTCFullYear();
  const marker = anniversaryDate(since, now.getUTCFullYear());
  if (now.getTime() < marker.getTime()) years -= 1;
  return Math.max(0, years);
}

export interface UpcomingAnniversary {
  years: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** 0 = today. */
  daysAway: number;
}

/**
 * The next anniversary, if it lands within `withinDays`.
 *
 * Returns null before the first full year. "Friends for 0 years" is not a
 * milestone, and celebrating one would be the app manufacturing an occasion.
 */
export function upcomingAnniversary(
  sinceIso: string | null | undefined,
  now: Date,
  withinDays = 30,
): UpcomingAnniversary | null {
  const since = parse(sinceIso);
  if (!since) return null;

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let next = anniversaryDate(since, today.getUTCFullYear());
  if (next.getTime() < today.getTime()) next = anniversaryDate(since, today.getUTCFullYear() + 1);

  const years = next.getUTCFullYear() - since.getUTCFullYear();
  if (years < 1) return null;

  const daysAway = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  if (daysAway > withinDays) return null;
  return { years, date: isoDate(next), daysAway };
}

/**
 * The timeline, oldest first.
 *
 * Past anniversaries are included only from the first full year, and only one
 * entry per year — a five-year friendship gets five marks, not five hundred
 * days of "still friends".
 */
export function buildTimeline(input: TimelineInput, now: Date): Milestone[] {
  const out: Milestone[] = [];

  const friends = parse(input.friendsSince);
  const following = parse(input.followingSince);
  const firstMessage = parse(input.firstMessageAt);

  if (friends) out.push({ kind: "friends_since", at: isoDate(friends), title: "Became friends" });
  if (following) out.push({ kind: "following_since", at: isoDate(following), title: "Started following" });
  if (firstMessage) out.push({ kind: "first_message", at: isoDate(firstMessage), title: "First message" });

  // Anniversaries hang off the strongest dated relationship available.
  const anchor = friends ?? following;
  if (anchor) {
    const years = yearsBetween(anchor, now);
    for (let y = 1; y <= years; y += 1) {
      const date = anniversaryDate(anchor, anchor.getUTCFullYear() + y);
      out.push({
        kind: "anniversary",
        at: isoDate(date),
        years: y,
        title: y === 1 ? "1 year" : `${y} years`,
      });
    }
  }

  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
