import { NextResponse } from "next/server";

import { getDiscoveryFeed } from "@/lib/social/discovery";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discovery?offset=&limit= — pagination for the "Discover people" grid
 * (lib/social/discovery.ts), so the full-screen deck (features/friends/discovery-deck.tsx)
 * can keep loading more creators' videos/photos as the viewer swipes through it.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const limit = Math.min(24, Math.max(1, Number(sp.get("limit") ?? 12) || 12));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let viewerLocation: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("profiles").select("location").eq("id", user.id).maybeSingle();
    viewerLocation = (data?.location as string) ?? null;
  } catch {
    /* location column not migrated yet */
  }

  const page = await getDiscoveryFeed(user.id, { offset, limit, viewerLocation });
  return NextResponse.json(page, {
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" },
  });
}
