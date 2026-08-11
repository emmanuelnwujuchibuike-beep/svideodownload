import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { RepostPageClient } from "@/features/social/repost/repost-page-client";
import { getPost } from "@/lib/social/posts";
import { repostHistory } from "@/lib/social/repost/history";
import { repostViewer } from "@/lib/social/repost/visibility";
import { createClient } from "@/lib/supabase/server";

/**
 * The Repost Page — one reel's full recommendation history
 * (Feature 15 · Part 4).
 *
 * "Every reel has its own repost history… Everything searchable."
 *
 * ── Server-rendered first page, client only for tabs and search ──────────
 * The list arrives in the HTML, so the page is useful before hydration and
 * costs nothing on a slow phone. Switching tab or typing a query re-filters
 * the SAME fetched set client-side — the three tabs are subsets of one
 * audience-filtered read, not three round-trips.
 *
 * ── The audience gate runs in `repostHistory`, before anything is counted ─
 * A friends-only repost is absent for a stranger including from the tab
 * totals: a count alone is enough to reveal that a private repost exists.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Reposts · Frenz" };
  const post = await getPost(id, null);
  return {
    title: post ? `Reposts of “${post.title}” · Frenz` : "Reposts · Frenz",
    // A recommendation list is a social surface, not a landing page — it should
    // not compete with the post itself in search results.
    robots: { index: false, follow: true },
  };
}

export default async function RepostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* signed out — the page still renders public reposts */
  }

  const post = await getPost(id, viewerId);
  if (!post) notFound();

  const viewer = await repostViewer(viewerId);
  const history = await repostHistory(id, viewer, { limit: 200 });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">
        <Link
          href={`/p/${id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          ← Back to the post
        </Link>

        <h1 className="mt-3 text-xl font-bold leading-tight">Reposts</h1>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.title}</p>

        <RepostPageClient postId={id} initial={history} isOwner={post.isOwner} />
      </main>
    </>
  );
}
