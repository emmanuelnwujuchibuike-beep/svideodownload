import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RelationshipManager } from "@/features/friends/relationship-manager";
import { relationshipDirectory } from "@/lib/social/lists/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage people",
  robots: { index: false, follow: false },
};

/** /friends/manage — the Relationship Manager (Feature 19 · Part 10). One directory read, everything else in the browser. */
export default async function ManageRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends/manage");
  const directory = await relationshipDirectory(user.id);
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <RelationshipManager initial={directory} />
    </div>
  );
}
