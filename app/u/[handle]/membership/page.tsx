import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MembershipPage } from "@/features/members/membership-page";
import { creatorPage } from "@/lib/creator/membership/server";
import { createClient } from "@/lib/supabase/server";
import { profilePath } from "@/lib/social/profile-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${handle} — membership`, robots: { index: false, follow: false } };
}

/** /u/<handle>/membership — a creator's free community and paid SUB subscription (Feature 19 · Part 13). */
export default async function MembershipRoute({ params }: { params: Promise<{ handle: string }> }) {
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
  const data = await creatorPage(handle, viewer);
  if (!data) notFound();
  return (
    <div className="ex-ground w-full flex-1">
      <main className="mx-auto w-full max-w-2xl flex-1 px-3 pb-16 pt-4 sm:px-4">
        {data === "restricted" ? (
          <div className="py-16 text-center">
            <p className="text-[15px] font-semibold">This profile is private.</p>
            <Link href={`${profilePath(handle)}`} className="mt-2 inline-block text-[14px] font-semibold text-primary">
              Back to the profile
            </Link>
          </div>
        ) : (
          <MembershipPage data={data} />
        )}
      </main>
    </div>
  );
}
