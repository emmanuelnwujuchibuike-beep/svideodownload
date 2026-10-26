/**
 * A story reply in a chat (2026-10-26, owner: "story reply shouldn't show with emoji, it should show with professional
 * premium icon"). The reply is an ordinary message whose text starts with "Replied to your story: " — "↩️ "-prefixed
 * before today — and, since Stories Part 4, carries `{ kind: "story_reply" }`. The chat draws the label with an icon
 * and shows only the reply itself; the stored text stays readable in a push, an email or the inbox list.
 */
export const STORY_REPLY_PREFIX = "Replied to your story: ";
const LEGACY_PREFIX = `↩️ ${STORY_REPLY_PREFIX}`;

/** The reply's own words when `body` is a story reply, else null. */
export function storyReplyText(body: string | null | undefined, metadata?: { kind?: unknown } | null): string | null {
  if (!body) return null;
  if (body.startsWith(LEGACY_PREFIX)) return body.slice(LEGACY_PREFIX.length);
  if (body.startsWith(STORY_REPLY_PREFIX)) return body.slice(STORY_REPLY_PREFIX.length);
  return metadata?.kind === "story_reply" ? body : null;
}
