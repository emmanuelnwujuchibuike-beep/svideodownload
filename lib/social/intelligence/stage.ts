/**
 * Relationship Strength™ as WORDS (Feature 19 · Part 8) — pure, no I/O.
 *
 * The brief: "Never display 95%, a friendship score, levels, XP, hearts.
 * Use elegant relationship descriptions." So a relationship has a STAGE, a
 * word and one gentle sentence, and nothing anywhere turns it into a number
 * (the stage tests assert no copy contains a digit).
 *
 * Every input is something the viewer already has: how long they have been
 * friends, and the messages in a chat they are half of (lib/social/graph/
 * strength.ts sets that rule). Nothing reads how the other person behaves
 * toward the viewer: no reply speed, no read receipts, no visits.
 *
 * Silence is not decay: a friendship that is new and quiet is "New
 * connection", not "Inactive", and nothing is called inactive until half a
 * year has passed without a word.
 */

export type RelationshipStage = "new" | "growing" | "consistent" | "established" | "long_term" | "legacy" | "inactive" | "archived";

export const STAGE_ORDER: readonly RelationshipStage[] = ["growing", "new", "consistent", "established", "long_term", "legacy", "inactive", "archived"];

export const STAGE_COPY: Record<RelationshipStage, { label: string; line: string }> = {
  new: { label: "New connection", line: "You’re just getting started." },
  growing: { label: "Growing", line: "You’ve been talking more lately." },
  consistent: { label: "Consistent", line: "You keep in touch." },
  established: { label: "Established", line: "Friends for over a year." },
  long_term: { label: "Long-term", line: "Friends for years." },
  legacy: { label: "Legacy connection", line: "A friendship that has lasted." },
  inactive: { label: "Quiet for a while", line: "You haven’t spoken in a long time." },
  archived: { label: "Archived", line: "Kept safe, out of the way." },
};

export interface StageInput {
  /** Days since the friendship began. */
  daysKnown: number;
  /** Days since the last message in your chat, or null if you never messaged. */
  daysSinceMessage: number | null;
  /** Messages in your chat in the last 90 days, and in the 90 days before. */
  msgs90: number;
  msgsPrev90: number;
  archived: boolean;
}

const QUIET_DAYS = 180;

export function relationshipStage(i: StageInput): RelationshipStage {
  if (i.archived) return "archived";
  const silent = i.daysSinceMessage == null ? i.daysKnown >= QUIET_DAYS : i.daysSinceMessage > QUIET_DAYS;
  if (silent) return "inactive";
  if (i.daysKnown < 90) return "new";
  if (i.msgs90 >= 10 && i.msgs90 >= i.msgsPrev90 * 1.5) return "growing";
  if (i.daysKnown >= 5 * 365) return "legacy";
  if (i.daysKnown >= 2 * 365) return "long_term";
  if (i.daysKnown >= 365) return "established";
  return "consistent";
}

/**
 * AI Reconnect™ — "You haven't spoken in several months." Only for friends you
 * HAVE spoken with, after a real silence, not archived, and not snoozed or
 * switched off for that friend. Said in words, never as a count of days.
 */
export interface ReconnectInput {
  daysSinceMessage: number | null;
  archived: boolean;
  reconnectOff: boolean;
  snoozedUntil: string | null;
  now: Date;
}
export function reconnectReason(i: ReconnectInput): string | null {
  if (i.archived || i.reconnectOff) return null;
  if (i.snoozedUntil && Date.parse(i.snoozedUntil) > i.now.getTime()) return null;
  const d = i.daysSinceMessage;
  if (d == null || d < 90) return null;
  if (d < 180) return "You haven’t spoken in a few months.";
  if (d < 365) return "You haven’t spoken in several months.";
  return "It’s been over a year since you last spoke.";
}

/** Relationship Evolution™: changes the platform can see for certain, as suggestions the member may take or ignore. */
export type Evolution =
  | { kind: "follow_to_friend"; reason: string }
  | { kind: "friend_to_business"; reason: string }
  | { kind: "friend_to_creator"; reason: string };

export function evolutionFor(i: { isFriend: boolean; youFollow: boolean; theyFollow: boolean; requestPending: boolean; profileType: string; hasLabel: boolean }): Evolution | null {
  if (!i.isFriend && i.youFollow && i.theyFollow && !i.requestPending) {
    return { kind: "follow_to_friend", reason: "You follow each other. Make it a friendship?" };
  }
  if (i.isFriend && !i.hasLabel && (i.profileType === "business" || i.profileType === "professional" || i.profileType === "organization")) {
    return { kind: "friend_to_business", reason: "Their profile is a business. Label them as a business contact?" };
  }
  if (i.isFriend && !i.hasLabel && i.profileType === "creator") {
    return { kind: "friend_to_creator", reason: "They create on Frenz. Label them as a creator you follow?" };
  }
  return null;
}

/** AI Memory Surface™: what is worth remembering in the next week. */
export interface Moment {
  kind: "anniversary" | "capsule";
  at: string;
  title: string;
  friendId: string;
}

/** Anniversaries (1 month, 6 months, every year) falling between now and `days` from now. */
export function upcomingAnniversaries(friends: readonly { id: string; name: string; since: string }[], now: Date, days = 7): Moment[] {
  const end = now.getTime() + days * 86_400_000;
  const out: Moment[] = [];
  for (const f of friends) {
    const s = new Date(f.since);
    if (Number.isNaN(s.getTime())) continue;
    const marks: [number, string][] = [[1, "1 month"], [6, "6 months"]];
    for (let y = 1; y <= 100; y += 1) marks.push([12 * y, y === 1 ? "1 year" : `${y} years`]);
    for (const [m, label] of marks) {
      const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + m, 1, s.getUTCHours(), s.getUTCMinutes()));
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(s.getUTCDate(), last));
      if (d.getTime() > end) break;
      if (d.getTime() >= now.getTime() - 86_400_000) out.push({ kind: "anniversary", at: d.toISOString(), title: `${label} of friendship with ${f.name}`, friendId: f.id });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title));
}
