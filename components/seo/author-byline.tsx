import Image from "next/image";

import { SITE_AUTHOR, authorIsPlaceholder, type SiteAuthor } from "@/config/author";
import { cn } from "@/lib/utils";

/** "2026-10-29" → "October 29, 2026", in UTC so the build machine's timezone can never shift a day. */
function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * The byline on every blog post and /learn guide: avatar, name, short bio, and the published / updated dates the
 * Article JSON-LD carries (owner, 2026-10-29). The person comes from `config/author.ts` — one record for every page.
 *
 * Server-rendered and static: no client JS on pages that are prerendered. With no avatar file configured it shows
 * the author's initials rather than a broken image.
 */
export function AuthorByline({
  published,
  updated,
  author = SITE_AUTHOR,
  className,
}: {
  published: string;
  updated?: string;
  author?: SiteAuthor;
  className?: string;
}) {
  const initials =
    author.name
      .replace(/[[\]]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "F";
  const edited = updated && updated !== published;

  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4", className)}>
      {author.avatar ? (
        <Image src={author.avatar} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {initials}
        </span>
      )}
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-foreground">
          By{" "}
          {author.url ? (
            <a href={author.url} rel="author" className="hover:underline">
              {author.name}
            </a>
          ) : (
            <span>{author.name}</span>
          )}
        </p>
        <p className="mt-0.5 leading-relaxed text-muted-foreground">{author.bio}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Published <time dateTime={published}>{longDate(published)}</time>
          {edited ? (
            <>
              {" · "}Updated <time dateTime={updated}>{longDate(updated)}</time>
            </>
          ) : null}
        </p>
        {/* a reminder that cannot be missed in a local build: config/author.ts still holds the placeholders */}
        {authorIsPlaceholder(author) ? (
          <p className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">Author details not filled in yet — edit config/author.ts.</p>
        ) : null}
      </div>
    </div>
  );
}
