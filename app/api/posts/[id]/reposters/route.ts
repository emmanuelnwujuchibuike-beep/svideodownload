import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { repostHistory, type RepostHistoryTab } from "@/lib/social/repost/history";
import { repostViewer } from "@/lib/social/repost/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReposterRow {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  caption: string | null;
  repostedAt: string;
  isFollowing: boolean;
  isFriend: boolean;
  isSelf: boolean;
  /** Only ever non-public on the viewer's OWN rows — see the note below. */
  audience: string;
  viaRepost: boolean;
}

const TABS: RepostHistoryTab[] = ["all", "friends", "quotes"];

/**
 * GET /api/posts/:id/reposters — who reposted this post.
 *
 * Serves both the avatar-cluster sheet (no params) and the full Repost Page
 * (`?tab=friends|quotes&q=search`). One endpoint rather than two, so the
 * audience gate cannot be applied to one surface and forgotten on the other.
 *
 * 🔴 This route USED to read the `reposts` table directly with no audience
 * filter. From migration 0116 a repost can be friends-only or private, so that
 * query would have listed restricted reposts to anyone who opened the sheet.
 * The filtering now lives in `repostHistory` → `filterVisibleReposts`, which is
 * the single predicate every read path shares.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab") as RepostHistoryTab | null;
  const tab = tabParam && TABS.includes(tabParam) ? tabParam : "all";
  const q = url.searchParams.get("q") ?? undefined;

  const viewer = await repostViewer(user?.id ?? null);
  const history = await repostHistory(id, viewer, { tab, query: q, limit: 100 });

  const reposters: ReposterRow[] = history.entries.map((e) => ({
    id: e.userId,
    handle: e.handle,
    displayName: e.displayName || e.handle,
    avatarUrl: e.avatarUrl,
    isVerified: e.isVerified,
    caption: e.caption,
    repostedAt: e.createdAt,
    isFollowing: e.isFollowing,
    isFriend: e.isFriend,
    isSelf: user?.id === e.userId,
    audience: e.audience,
    viaRepost: e.viaRepost,
  }));

  return NextResponse.json({ reposters, counts: history.counts, tab });
}
