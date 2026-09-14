import { NextResponse } from "next/server";

import { isHubKey } from "@/lib/profile/hub";
import { readHubSection } from "@/lib/profile/hub-data";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/profile/[handle]/hub/[key] — one profile section, on demand.
 *
 * Owner, 2026-09-13: the profile's cards became buttons that open a modal,
 * "so all modal prefetch as they scroll and they shouldn't prefetch at once".
 * This is what a button fetches — when it scrolls into view (one at a time,
 * see features/profile/profile-hub.tsx) or when it is tapped.
 *
 * The viewer is the SESSION, never a query parameter; every gate is
 * re-applied inside `readHubSection` on each read. `private` so a shared
 * cache can never hand one member's journal to another; a minute of
 * browser cache so a reopen within the same visit costs nothing.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ handle: string; key: string }> }) {
  const { handle, key } = await ctx.params;
  if (!isHubKey(key)) return NextResponse.json({ error: "Unknown section." }, { status: 404 });

  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    viewerId = null;
  }

  try {
    const read = await readHubSection(handle, key, viewerId);
    if (!read.ok) {
      return NextResponse.json(
        { error: read.status === 404 ? "Not found." : read.status === 401 ? "Sign in to see this." : "Not available." },
        { status: read.status, headers: { "cache-control": "private, no-store" } },
      );
    }
    return NextResponse.json(read.payload, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    console.error("[profile/hub] read failed", { handle, key, error: String(e) });
    return NextResponse.json({ error: "Couldn't load this section." }, { status: 500, headers: { "cache-control": "private, no-store" } });
  }
}
