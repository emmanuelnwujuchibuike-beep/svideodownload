import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/security/verify-alert?ref=FZ-XXXXXXXX — "Verify an alert" (Feature 20 Part 7,
 * Notification Authenticity). Every Frenz security notification carries a reference code
 * stored on the member's OWN notification row. Only Frenz can put a row in someone's account,
 * so a code found here is a genuine Frenz alert; a code that isn't is not from Frenz.
 *
 * Reads only the signed-in member's own rows, only security types. Rate-limited so codes
 * can't be guessed by brute force (they are 8 characters from a 32-letter alphabet anyway).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`verify-alert:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many checks — try again in a minute." }, { status: 429 });

  const raw = (new URL(request.url).searchParams.get("ref") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const ref = raw.startsWith("FZ-") ? raw : `FZ-${raw.replace(/^FZ/, "")}`;
  if (!/^FZ-[A-Z2-9]{8}$/.test(ref)) return NextResponse.json({ genuine: false, reason: "format" }, { headers: { "Cache-Control": "private, no-store" } });

  const { data } = await createAdminClient()
    .from("notifications")
    .select("type, created_at, data")
    .eq("user_id", user.id)
    .like("type", "security_%")
    .eq("data->>ref", ref)
    .limit(1)
    .maybeSingle();
  const row = data as { type: string; created_at: string; data: { title?: string; body?: string } | null } | null;
  return NextResponse.json(
    row ? { genuine: true, ref, title: row.data?.title ?? "Security alert", at: row.created_at } : { genuine: false, ref, reason: "not_found" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
