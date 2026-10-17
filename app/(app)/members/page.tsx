import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreatorDashboard } from "@/features/members/creator-dashboard";
import { creatorDashboard, myMemberships } from "@/lib/creator/membership/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Members", robots: { index: false, follow: false } };

/** /members — the creator's community and the memberships the viewer holds (Feature 19 · Part 13). */
export default async function MembersRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/members");
  const [dashboard, held, { data: me }] = await Promise.all([creatorDashboard(user.id), myMemberships(user.id), supabase.from("profiles").select("handle").eq("id", user.id).maybeSingle()]);
  return (
    <div className="ex-ground w-full flex-1">
      <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
        <CreatorDashboard initial={dashboard} held={held} handle={(me as { handle?: string } | null)?.handle ?? ""} />
      </div>
    </div>
  );
}
