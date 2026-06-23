import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/keys/[id] — revoke a key the signed-in user owns. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("api_keys")
    .update({ revoked: true })
    .eq("id", id)
    .eq("user_id", user.id); // ownership enforced

  if (error) return NextResponse.json({ error: "Couldn't revoke key." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
