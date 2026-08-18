import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { isAdmin } from "@/lib/admin";
import { PostPageView, postPageMetadata } from "@/features/social/post-page-view";
import { getPost } from "@/lib/social/posts";
import { postHref } from "@/lib/social/post-url";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function viewer(): Promise<{ id: string | null; admin: boolean }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { id: null, admin: false };
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    return { id: user.id, admin: isAdmin(profile?.role, user.email) };
  } catch {
    return { id: null, admin: false };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Not found", robots: { index: false, follow: false } };
  const post = await getPost(id, null);
  if (!post) return { title: "Not found", robots: { index: false, follow: false } };
  // Moot once a redirect actually fires below (the response has no body to
  // put this metadata into), but harmless — see the redirect's own note.
  return postPageMetadata(post, `/p/${post.id}`);
}

/**
 * /p/[id] — the permanent, never-changing post URL. Stays the canonical for
 * an uncategorized post (nowhere principled to live at /[category]/...) and
 * for any post migration 0126/its backfill hasn't reached yet; every other
 * post 301s to its descriptive /[category]/[year]/[month]/[slug] URL below,
 * consolidating old links'/shares' authority onto the new one rather than
 * leaving two indexable URLs for the same content (see post-url.ts's
 * postHref — the single function that decides this for every surface: the
 * feed, PostGrid, share/copy-link, the sitemaps, and this redirect).
 */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { id: me, admin: viewerIsAdmin } = await viewer();
  const post = await getPost(id, me, viewerIsAdmin);
  if (!post) notFound();

  if (post.slug && post.category) {
    const canonical = postHref(post);
    if (canonical !== `/p/${post.id}`) redirect(canonical);
  }

  return <PostPageView post={post} me={me} canonicalPath={`/p/${post.id}`} />;
}
