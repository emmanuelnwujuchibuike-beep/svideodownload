import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GraphPage } from "@/features/graph/graph-page";
import { graphGrowth } from "@/lib/social/graph/graph-server";
import { trustFor } from "@/lib/social/graph/trust-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your network",
  robots: { index: false, follow: false },
};

/** /friends/graph — Your network (Feature 19 · Part 15): graph search, trust explained, private growth and history. */
export default async function GraphRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends/graph");
  const [trust, growth] = await Promise.all([trustFor(user.id), graphGrowth(user.id)]);
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <GraphPage trust={trust} growth={growth} />
    </div>
  );
}
