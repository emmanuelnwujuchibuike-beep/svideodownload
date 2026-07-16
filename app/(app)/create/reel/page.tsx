import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ReelComposer } from "@/features/create/surfaces/reel-composer";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New reel",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** The dedicated Reel surface — see the note on /create/post for why the three
 *  create surfaces are separate routes inside the (app) shell. */
export default async function CreateReelPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/create/reel");

  return <ReelComposer />;
}
