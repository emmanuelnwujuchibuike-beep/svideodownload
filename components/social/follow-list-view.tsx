import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { UserList } from "@/components/social/user-list";
import { getPublicProfile, listFollowers, listFollowing } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared page body for /u/[handle]/followers and /following. Privacy-gated:
 * shows a private notice when the viewer isn't allowed to see the list.
 */
export async function FollowListView({
  handle,
  kind,
}: {
  handle: string;
  kind: "followers" | "following";
}) {
  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon */
  }

  const profile = await getPublicProfile(handle, viewerId);
  if (!profile) notFound();

  const users =
    kind === "followers"
      ? await listFollowers(profile.id, viewerId)
      : await listFollowing(profile.id, viewerId);

  const title = kind === "followers" ? "Followers" : "Following";

  return (
    <>
      <SiteHeader />
      <main className="container max-w-2xl pb-24 pt-28 sm:pt-32">
        <Link
          href={`/u/${profile.handle}`}
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {profile.displayName}
        </Link>
        <h1 className="mb-4 text-xl font-bold tracking-[-0.02em]">{title}</h1>

        <div className="rounded-2xl border border-border/70 bg-card px-4 shadow-soft">
          {users === null ? (
            <div className="py-12 text-center">
              <Lock className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">This list is private</p>
              <p className="mt-1 text-sm text-muted-foreground">
                @{profile.handle} limits who can see their {title.toLowerCase()}.
              </p>
            </div>
          ) : (
            <UserList
              users={users}
              viewerId={viewerId}
              emptyText={kind === "followers" ? "No followers yet." : "Not following anyone yet."}
            />
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
