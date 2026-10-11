import { NextResponse } from "next/server";

import { listBanks } from "@/lib/rewards/paystack-banks";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — banks Paystack can pay a withdrawal into (cached a day on the server). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ banks: [] }, { status: 401 });
  try {
    return NextResponse.json({ banks: await listBanks() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ banks: [], error: "Paystack isn't available right now." }, { status: 503 });
  }
}
