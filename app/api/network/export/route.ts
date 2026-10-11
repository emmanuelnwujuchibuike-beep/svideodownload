import { NextResponse } from "next/server";

import { exportNetwork } from "@/lib/social/professional/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the member's professional network as a JSON file: connections both ways, recommendations, endorsements, credentials, opportunities. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const data = await exportNetwork(user.id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="frenz-professional-network.json"', "Cache-Control": "private, no-store" },
  });
}
