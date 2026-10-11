import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MemoriesPage } from "@/features/memories/memories-page";
import { composerOptions, memoryLibrary } from "@/lib/social/memories/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Memories",
  robots: { index: false, follow: false },
};

/** /memories — Shared Memories™ and Life Journey™ (Feature 19 · Part 14). One read for the library and the composer; suggestions, search and the archive load on demand. */
export default async function MemoriesRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/memories");
  const [library, options] = await Promise.all([memoryLibrary(user.id), composerOptions(user.id)]);
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <MemoriesPage initial={library} friends={options.friends} circles={options.circles} joinedAt={options.joinedAt} />
    </div>
  );
}
