import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NetworkDashboard } from "@/features/network/network-dashboard";
import { networkDashboard } from "@/lib/social/professional/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Professional network", robots: { index: false, follow: false } };

/** /network — the Professional Network dashboard (Feature 19 · Part 12). One server read, then everything happens on the tap. */
export default async function NetworkRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/network");
  const data = await networkDashboard(user.id);
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <NetworkDashboard initial={data} />
    </div>
  );
}
