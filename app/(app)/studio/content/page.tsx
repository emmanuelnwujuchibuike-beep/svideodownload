import { FolderOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ContentManager } from "@/features/studio/content-manager";
import { StudioCard } from "@/features/studio/studio-ui";
import { listCreatorContent, type ContentFilter } from "@/lib/creator/content";
import { listViewableCollections } from "@/lib/social/collections";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content" };

const FILTERS = new Set<ContentFilter>(["all", "published", "scheduled", "archived", "pinned"]);

/**
 * Content management (Feature 15 · Part 9).
 *
 * FOLDERS are the existing Collections feature, surfaced here rather than
 * reimplemented. A third grouping noun ("series", "playlists") with no
 * behavioural difference from a collection would be inventory, not a feature —
 * that call is stated in the Part doc rather than silently made.
 */
export default async function StudioContentPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/content");

  const sp = await searchParams;
  const filter = (sp.filter && FILTERS.has(sp.filter as ContentFilter) ? sp.filter : "all") as ContentFilter;
  const search = (sp.q ?? "").slice(0, 80);

  const [page, collections] = await Promise.all([
    listCreatorContent(user.id, filter, search),
    listViewableCollections(user.id, user.id, false).catch(() => []),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Your content</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit, pin, schedule and archive everything you&apos;ve published.
        </p>
      </header>

      <ContentManager
        items={page.items}
        counts={page.counts}
        filter={filter}
        search={search}
        truncated={page.truncated}
      />

      <StudioCard
        title="Folders"
        icon={FolderOpen}
        subtitle="Your collections — the same ones that appear on your profile"
        action={
          <Link href="/saved" prefetch className="text-xs font-semibold text-primary hover:opacity-80">
            Manage
          </Link>
        }
      >
        {collections.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-center text-xs text-muted-foreground">
            No collections yet. They group posts into a named, shareable set — the folders this page would
            otherwise need to invent.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {collections.slice(0, 12).map((c) => (
              <li key={c.id}>
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold">
                  {c.name}
                  <span className="tabular-nums text-muted-foreground">{c.count}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </StudioCard>
    </div>
  );
}
