import { NextResponse } from "next/server";

import { getOrbitFeed, ORBITS, type OrbitId } from "@/lib/social/orbits";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID = new Set(ORBITS.map((o) => o.id));

/** GET /api/orbit?orbit=creator&limit=12 — Discovery Orbit™ (Feature 15 Part 8). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orbit = url.searchParams.get("orbit") ?? "";
  if (!VALID.has(orbit as OrbitId)) return NextResponse.json({ error: "Unknown orbit." }, { status: 400 });
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit")) || 12));

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

  const result = await getOrbitFeed(orbit as OrbitId, viewerId, limit);
  return NextResponse.json(result);
}
