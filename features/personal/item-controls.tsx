"use client";

import { Bookmark, BookmarkCheck, Check, Circle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useUser } from "@/features/auth/use-user";
import { setPersonalItem, usePersonalItem } from "@/features/personal/use-personal";
import type { PersonalItemKind } from "@/lib/personal/items";
import { cn } from "@/lib/utils";

/**
 * "Mark as done" and "Save for later" on a lesson or a support article.
 *
 * ── A client island on a static page ──────────────────────────────────────────
 *
 * Every page this appears on is prerendered and served from the CDN. That is
 * deliberate and it is the reason those pages are fast, so this component reads
 * the viewer's state on the client AFTER paint rather than during render. The
 * document stays anonymous and cacheable; only this small control knows who is
 * reading. Rendering it server-side would opt the whole route out of static
 * generation for the sake of two buttons.
 *
 * ── Signed-out readers see the controls ───────────────────────────────────────
 *
 * They link to sign-in with a return path rather than being hidden. A control
 * nobody can see is a feature nobody discovers, and this is a real reason to
 * have an account — which is exactly what the sign-in copy promises. What they
 * must never do is *look* interactive and then silently fail, so signed out they
 * are links, not buttons.
 */
export function PersonalItemControls({
  kind,
  slug,
  className,
}: {
  kind: PersonalItemKind;
  slug: string;
  className?: string;
}) {
  const { user, loading } = useUser();
  const item = usePersonalItem(kind, slug);
  const pathname = usePathname();

  const done = Boolean(item?.completedAt);
  const saved = Boolean(item?.bookmarkedAt);

  /*
    Nothing renders until auth resolves.

    The alternative is painting the signed-out state and swapping it a moment
    later, which on this audience's connections is long enough to read as the
    page changing its mind — and worse, long enough to tap.
  */
  if (loading) return <div className={cn("h-9", className)} aria-hidden />;

  if (!user) {
    const next = encodeURIComponent(pathname ?? "/");
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <Link
          href={`/login?next=${next}`}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Circle aria-hidden className="h-4 w-4" />
          Mark as done
        </Link>
        <Link
          href={`/login?next=${next}`}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Bookmark aria-hidden className="h-4 w-4" />
          Save
        </Link>
        <p className="w-full text-xs text-muted-foreground sm:w-auto">
          Sign in to keep track of what you have read.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <button
        type="button"
        aria-pressed={done}
        onClick={() => void setPersonalItem(kind, slug, { completed: !done })}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          done
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        )}
      >
        {done ? (
          <Check aria-hidden className="h-4 w-4" />
        ) : (
          <Circle aria-hidden className="h-4 w-4" />
        )}
        {done ? "Done" : "Mark as done"}
      </button>

      <button
        type="button"
        aria-pressed={saved}
        onClick={() => void setPersonalItem(kind, slug, { bookmarked: !saved })}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          saved
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        )}
      >
        {saved ? (
          <BookmarkCheck aria-hidden className="h-4 w-4" />
        ) : (
          <Bookmark aria-hidden className="h-4 w-4" />
        )}
        {saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}
