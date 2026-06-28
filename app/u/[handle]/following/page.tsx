import type { Metadata } from "next";

import { FollowListView } from "@/components/social/follow-list-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Following",
  robots: { index: false, follow: false },
};

export default async function FollowingPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return <FollowListView handle={handle} kind="following" />;
}
