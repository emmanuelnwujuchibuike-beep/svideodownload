"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useSearchCommit } from "@/features/search/search-commit";
import type { SearchType } from "@/lib/social/search";

/**
 * A control that runs a search on THIS page instead of navigating to it.
 *
 * Renders a `<button>` when the search page is above it (the normal case) and
 * a real `<Link>` otherwise, so the same card still works if it is ever reused
 * on a surface that has no search state to drive. See `search-commit.tsx` for
 * why a same-route `<Link>` was the wrong tool here.
 */
export function SearchAction({
  term,
  type,
  className,
  ariaLabel,
  children,
}: {
  term: string;
  type: SearchType;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const commit = useSearchCommit();

  if (!commit) {
    const sp = new URLSearchParams({ q: term });
    if (type !== "all") sp.set("type", type);
    return (
      <Link href={`/search?${sp.toString()}`} aria-label={ariaLabel} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => commit(term, type)} aria-label={ariaLabel} className={className}>
      {children}
    </button>
  );
}
