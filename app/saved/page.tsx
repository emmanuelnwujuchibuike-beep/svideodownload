import { Bookmark } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PostGrid } from "@/components/social/post-grid";
import { listSavedPosts } from "@/lib/social/posts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Saved",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function SavedPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/saved");

  const posts = await listSavedPosts(user.id);

  return (
    <>
      <SiteHeader />
      <main className="container max-w-5xl pb-24 pt-28 sm:pt-36">
        <header className="mb-6 flex items-center gap-2">
          <Bookmark className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Saved</h1>
        </header>
        <PostGrid posts={posts} emptyText="Nothing saved yet — tap the bookmark on any post to save it." />
      </main>
      <SiteFooter />
    </>
  );
}
