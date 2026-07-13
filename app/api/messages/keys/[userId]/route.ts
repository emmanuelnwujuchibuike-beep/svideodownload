import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/messages/keys/:userId — another user's Secret Chat public key (Part 11b), or null if they've never generated one. Public by definition — any signed-in user may read it. */
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { data } = await createAdminClient()
    .from("user_encryption_keys")
    .select("public_key")
    .eq("user_id", userId)
    .maybeSingle();

  return NextResponse.json({ ok: true, publicKey: data?.public_key ?? null });
}
