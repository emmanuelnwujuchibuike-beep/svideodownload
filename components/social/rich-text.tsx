import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Renders caption/description text with #hashtags and @mentions turned into
 * links — the standard "professional" social affordance. Hashtags open Explore
 * search; mentions open the user's profile. Server-safe (no hooks); pass a
 * `linkClassName` to theme the links per surface (e.g. white on a reel).
 */
const TOKEN = /(#[\p{L}\p{N}_]+|@[A-Za-z0-9_.]+)/gu;

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
    const token = m[0];
    const start = m.index;
    if (start > last) nodes.push(text.slice(last, start));

    if (token.startsWith("#")) {
      const tag = token.slice(1);
      nodes.push(
        <Link key={`h${key++}`} href={`/explore?q=${encodeURIComponent(`#${tag}`)}`} className={linkClassName}>
          {token}
        </Link>,
      );
    } else {
      const handle = token.slice(1).replace(/\.$/, ""); // trailing dot isn't part of a handle
      nodes.push(
        <Link key={`m${key++}`} href={`/u/${handle}`} className={linkClassName}>
          {token}
        </Link>,
      );
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return <span className={className}>{nodes}</span>;
}
