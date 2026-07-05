import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { searchAll, type SearchType } from "@/lib/social/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: SearchType[] = ["all", "people", "video", "image", "audio"];

/** GET /api/search?q=&type= — universal search (people + posts by kind). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const typeParam = url.searchParams.get("type") ?? "all";
  const type: SearchType = (TYPES.includes(typeParam as SearchType) ? typeParam : "all") as SearchType;
  if (!q) return NextResponse.json({ people: [], posts: [] });

  // Viewer (bearer or cookie) so people results carry correct follow state.
  const user = await getRequestUser(request);
  const result = await searchAll(q, type, user?.id ?? null);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
