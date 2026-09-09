"use client";

import { ChevronRight, History } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { listAiJobs } from "@/lib/ai/client";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DOOR TO YOUR VIDEOS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "I still don't see the AI history button and page in the
 * AI landing page so users can see all their video edits they made even non
 * signed in users."
 *
 * ── 🔴 A BUTTON, BECAUSE TWO ATTEMPTS AT A SECTION BOTH FAILED ─────────────
 *
 * The list was first at the bottom of this page, then moved up it. Neither was
 * findable, and the reason is the same both times: a strip of rows underneath a
 * hero reads as part of the hero's page, not as somewhere you can GO. A row
 * with a count and a chevron reads as a destination, which is what it now is.
 *
 * ── The count is the whole point of fetching anything ──────────────────────
 *
 * "3 videos" is what tells somebody there is something behind this. Without it
 * the row is an invitation to check whether they have anything, which is a
 * worse ask than answering it.
 *
 * 🔴 ONE request, the cheapest the API offers: `limit: 1`, whose only purpose
 * is to learn whether the list is non-empty and get a cursor. It never loads
 * the history itself — that is the destination's job — so this costs a single
 * small JSON round trip on a page that already makes one for the allowance.
 *
 * Renders as a plain row until that answer arrives, and stays a plain row if it
 * never does. A refusal here is not worth showing: the door still works.
 */
export function FrenzAIHistoryLink({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  /** null = not answered yet. A number = how many we know about. */
  const [count, setCount] = useState<number | null>(null);
  /** True when there is at least one more page than we asked for. */
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    void listAiJobs({ feature: "ai_clean", limit: 1 }).then((res) => {
      if (!alive || !res.ok) return;
      setCount(res.jobs.length);
      setMore(!!res.nextCursor);
    });
    return () => {
      alive = false;
    };
  }, []);

  /*
    "1+" rather than a real total. Counting every row would mean a second query
    whose only output is a number on a link — and the exact figure is one tap
    away. Overstating is the one thing it must not do, so it says what it knows.
  */
  const label =
    count === null
      ? "See everything you've cleaned"
      : count === 0
        ? "Nothing cleaned yet"
        : more
          ? "See everything you've cleaned"
          : `${count} video${count === 1 ? "" : "s"} ready to download`;

  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/95 px-4 py-3.5",
        "transition hover:border-primary/30 active:scale-[0.995]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <History className="h-[18px] w-[18px]" aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-tight">Your videos</span>
        <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">{label}</span>
      </span>

      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
