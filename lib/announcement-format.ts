/**
 * The announcement banner's built-in house style (owner, 2026-10-18: "the
 * announcement must look professional and have an inbuilt professional format").
 *
 * Admins type the message freely in the dashboard; this tidies it at render time
 * so the bar always reads as edited copy, whatever was typed:
 *   - runs of spaces collapse, and no space sits before , . ! ? ; :
 *   - one space follows , ; : and a sentence end when a word comes next
 *   - every sentence starts with a capital
 *   - the message ends with punctuation (an emoji ending is left alone)
 * The first sentence becomes a headline when more copy follows it — the bar
 * shows it bold in the brand face and the rest in the body face.
 *
 * Pure and client-safe: it never changes the stored text (the dismissal hash in
 * lib/announcement.ts still keys on what the admin wrote).
 */

export interface FormattedAnnouncement {
  /** The first sentence, when the message has more than one and it is short. */
  headline: string | null;
  /** The rest — or the whole message when there is no headline. */
  body: string;
}

/** A headline longer than this reads as a paragraph, so it stays in the body. */
const HEADLINE_MAX = 60;

export function tidyAnnouncementText(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = s
    // no space before punctuation: "late ," → "late,"
    .replace(/\s+([,.!?;:])/g, "$1")
    // one space after , ; : before a letter (never inside 1,000, 10:30 or https://)
    .replace(/([,;:])(?=[A-Za-z])/g, "$1 ")
    // one space after a sentence end before a letter (not inside a URL or "3.5")
    .replace(/([!?])(?=[A-Za-z])/g, "$1 ")
    .replace(/([a-z]{2})\.(?=[A-Z])/g, "$1. ");
  // capital at the start of every sentence
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, c: string) => lead + c.toUpperCase());
  // close the message with punctuation, unless it already ends in one or in an emoji / symbol
  if (/[A-Za-z0-9)"'”’]$/.test(s)) s += ".";
  return s;
}

export function formatAnnouncement(raw: string): FormattedAnnouncement {
  const text = tidyAnnouncementText(raw);
  // first sentence = up to the first . ! ? that is followed by a space and more copy
  const m = /^(.+?[.!?])\s+(\S.*)$/.exec(text);
  if (m && m[1] && m[2] && m[1].length <= HEADLINE_MAX) return { headline: m[1], body: m[2] };
  return { headline: null, body: text };
}
