import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicNetworkPage } from "@/features/network/public-network";
import { publicNetwork } from "@/lib/social/professional/server";
import { createClient } from "@/lib/supabase/server";
import { profilePath } from "@/lib/social/profile-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  // a sharing surface: the profile itself is the page search engines should hold
  return { title: `@${handle} — professional`, robots: { index: false, follow: false } };
}

/**
 * /u/<handle>/network — someone's professional side (Feature 19 · Part 12).
 * getPublicProfile decides who may see it at all, the profile engine decides
 * which career sections, and their friend-list setting decides their connections.
 */
export default async function PublicNetworkRoute({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  let viewer: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewer = user?.id ?? null;
  } catch {
    viewer = null;
  }
  const data = await publicNetwork(handle, viewer);
  if (!data) notFound();
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-3 pb-16 pt-4 sm:px-4">
      {data === "restricted" ? (
        <div className="py-16 text-center">
          <p className="text-[15px] font-semibold">This profile is private.</p>
          <Link href={`${profilePath(handle)}`} className="mt-2 inline-block text-[14px] font-semibold text-primary">
            Back to the profile
          </Link>
        </div>
      ) : (
        <PublicNetworkPage data={data} />
      )}
    </main>
  );
}
