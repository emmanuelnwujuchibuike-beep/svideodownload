import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Renders caption/description text with #hashtags, @mentions, and bare URLs
 * turned into links — the standard "professional" social affordance. Hashtags
 * open Explore search; mentions open the user's profile; URLs open externally.
 * Server-safe (no hooks); pass a `linkClassName` to theme the links per
 * surface (e.g. white on a reel).
 */
const TOKEN = /(#[\p{L}\p{N}_]+|@[A-Za-z0-9_.]+|https?:\/\/[^\s<>"']+)/gu;
// Trailing punctuation a URL regex can't tell apart from real sentence
// punctuation (a link at the end of "check this out: https://x.com/y." should
// not swallow the period).
const TRAILING_PUNCT = /[.,!?;:)\]]+$/;

export function RichText({
  text,
  className,
  linkClassName = "font-semibold text-primary hover:underline",
}: {
  text: string | null | undefined;
  className?: string;
  linkClassName?: string;
}) {
  if (!text) return null;

  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  TOKEN.lastIndex = 0;

  while ((m = TOKEN.exec(text)) !== null) {
    let token = m[0];
    const start = m.index;
    if (start > last) nodes.push(text.slice(last, start));

    if (token.startsWith("#")) {
      const tag = token.slice(1);
      nodes.push(
        <Link key={`h${key++}`} href={`/explore?q=${encodeURIComponent(`#${tag}`)}`} className={linkClassName}>
          {token}
        </Link>,
      );
    } else if (token.startsWith("@")) {
      const handle = token.slice(1).replace(/\.$/, ""); // trailing dot isn't part of a handle
      nodes.push(
        <Link key={`m${key++}`} href={`/u/${handle}`} className={linkClassName}>
          {token}
        </Link>,
      );
    } else {
      // Bare URL — strip trailing sentence punctuation so it doesn't get
      // swallowed into the link, and put it back as plain text after.
      const trailing = token.match(TRAILING_PUNCT)?.[0] ?? "";
      if (trailing) token = token.slice(0, -trailing.length);
      nodes.push(
        <a key={`u${key++}`} href={token} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          {token}
        </a>,
      );
      if (trailing) nodes.push(trailing);
    }
    last = start + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));

  /*
    🔴 `whitespace-pre-line` IS WHAT MAKES PARAGRAPHS SURVIVE (owner,
    2026-08-23: "I want caption in feed and reels to be able to give paragraph
    when I give them a keyboard").

    The newlines were never lost — they were stored, fetched and handed to this
    component intact. HTML simply collapses them: by default every run of
    whitespace, line breaks included, renders as a single space, so a caption
    typed as three paragraphs came out as one wall of text on every surface
    that renders through here (feed, reels, post page, comments, messages).

    `pre-line` rather than `pre-wrap`: it honours newlines but still COLLAPSES
    runs of spaces and, critically, still wraps normally. `pre-wrap` would
    preserve every leading space and stray double-space too, which on a
    narrow reel caption produces ragged indentation nobody typed on purpose.

    It leads the class list so a caller's own `className` still wins — reels
    already passes its own text/colour utilities through here.
  */
  return <span className={cn("whitespace-pre-line", className)}>{nodes}</span>;
}
