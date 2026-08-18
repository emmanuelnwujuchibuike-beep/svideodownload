import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { isAdmin } from "@/lib/admin";
import { PostPageView, postPageMetadata } from "@/features/social/post-page-view";
import { isCategory } from "@/lib/social/categories";
import { getPostBySlug } from "@/lib/social/posts";
import { postHref } from "@/lib/social/post-url";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/*
  🔴 Lives at [downloader]/[year]/[month]/[slug], not a standalone
  [category]/[year]/[month]/[slug] tree, because Next.js only allows ONE
  dynamic segment name at a given tree position across the whole app (route
  groups are transparent to this) — and app/(marketing)/[downloader]/
  already claims the bare top-level slot for the ~150 generated downloader-
  tool pages ("You cannot use different slug names for the same dynamic
  path", caught empirically: `next build` errors on it). The param is still
  a CATEGORY value at this depth (posts never live under an actual
  downloader-tool slug — see the sibling page.tsx's own early branch), so
  it's destructured and used as `category` below; only the folder/param name
  is forced by that constraint. The resulting public URL is unaffected:
  postHref() (lib/social/post-url.ts) builds /[category]/[year]/[month]/[slug]
  purely as a string, with no knowledge of which file produces it.
*/
type Params = { downloader: string; year: string; month: string; slug: string };

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

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { downloader: category, slug } = await params;
  if (!isCategory(category)) return { title: "Not found", robots: { index: false, follow: false } };
  const post = await getPostBySlug(slug, null);
  if (!post) return { title: "Not found", robots: { index: false, follow: false } };
  return postPageMetadata(post, postHref(post));
}

/**
 * The descriptive SEO post URL — /[category]/[year]/[month]/[slug]. Only
 * `slug` actually identifies the post (it carries a unique id suffix — see
 * post-url.ts's slugifyTitle); category/year/month exist to make the URL
 * readable, not to look the post up. If the requested path doesn't exactly
 * match what `postHref` computes for the real post (wrong category after a
 * re-categorization, wrong year/month, anything) this redirects to the
 * correct one rather than 404ing — keeps an old shared link alive instead of
 * breaking it. app/p/[id] is the fallback/permanent URL this exists
 * alongside; see that file's own note.
 */
export default async function CategoryPostPage({ params }: { params: Promise<Params> }) {
  const { downloader: category, year, month, slug } = await params;
  if (!isCategory(category)) notFound();

  const { id: me, admin: viewerIsAdmin } = await viewer();
  const post = await getPostBySlug(slug, me, viewerIsAdmin);
  if (!post) notFound();

  const canonical = postHref(post);
  if (canonical !== `/${category}/${year}/${month}/${slug}`) redirect(canonical);

  return <PostPageView post={post} me={me} canonicalPath={canonical} />;
}
