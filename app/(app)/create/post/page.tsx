import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PostComposer } from "@/features/create/surfaces/post-composer";
import { getHomeProfile } from "@/lib/social/home";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create post",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The dedicated Post surface. Post, Reel and Story are three separate routes
 * with three separate surfaces (owner, 2026-07-16) — the "+" sheet, the topbar
 * and the stories rails each open the one they mean, instead of every button
 * landing on one shared composer the user then had to re-steer.
 *
 * Lives inside the (app) group on purpose: the persistent shell (sidebar,
 * topbar, nav) stays mounted across the navigation, so opening the composer is
 * an instant client-side transition. The surface itself is a full-screen
 * `fixed` layer that covers that chrome — the same thing message threads do.
 */
export default async function CreatePostPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/create/post");

  const profile = await getHomeProfile(user.id);

  return (
    <PostComposer
      displayName={profile?.displayName || "You"}
      avatarUrl={profile?.avatarUrl ?? null}
    />
  );
}
