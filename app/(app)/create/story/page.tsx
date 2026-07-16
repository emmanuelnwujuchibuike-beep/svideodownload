import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StoryComposer } from "@/features/create/surfaces/story-composer";
import { getHomeProfile } from "@/lib/social/home";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add to story",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** The dedicated Story surface — see the note on /create/post for why the three
 *  create surfaces are separate routes inside the (app) shell. */
export default async function CreateStoryPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/create/story");

  const profile = await getHomeProfile(user.id);

  return <StoryComposer avatarUrl={profile?.avatarUrl ?? null} />;
}
