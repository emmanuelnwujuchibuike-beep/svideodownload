import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InsightsPage } from "@/features/friends/insights-page";
import { relationshipIntelligence } from "@/lib/social/intelligence/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your connections",
  robots: { index: false, follow: false },
};

/** /friends/insights — the private Social Intelligence dashboard (Feature 19 · Part 8). */
export default async function InsightsRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends/insights");
  const intel = await relationshipIntelligence(user.id);
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <InsightsPage intel={intel} />
    </div>
  );
}
