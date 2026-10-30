import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { listLibrary } from "@/lib/social/sound-library";
import { chipById, isLibraryTab, isPersonalTab } from "@/lib/social/sound-library-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sounds/library?tab=trending|new|following|saved&chip=<tag>&q= — the Sounds page's list
 * (design/frenz-sounds.html). Trending and New are the same for everyone, so the CDN answers them for a minute; For you
 * and Saved are the member's own and never cached. Signed out, those two answer an empty list (the page asks them to
 * sign in).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const tab = isLibraryTab(tabParam) ? tabParam : "trending";
  const chip = chipById(url.searchParams.get("chip"));
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60) || null;
  const personal = isPersonalTab(tab);
  const viewer = personal ? await getRequestUser(request) : null;
  const sounds = await listLibrary({ tab, chip, q, viewerId: viewer?.id ?? null });
  return NextResponse.json(
    { tab, sounds, signedIn: personal ? !!viewer : undefined },
    { headers: { "Cache-Control": personal ? "private, no-store" : "public, max-age=15, s-maxage=60, stale-while-revalidate=300" } },
  );
}
