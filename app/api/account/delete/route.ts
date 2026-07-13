import { NextResponse } from "next/server";

import { ACCOUNT_DELETION_GRACE_DAYS } from "@/lib/account/deletion";
import { writeAuditLog } from "@/lib/security/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — whether a deletion is currently requested, and when it'd actually purge. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data } = await supabase.from("profiles").select("deletion_requested_at").eq("id", user.id).maybeSingle();
  const requestedAt = data?.deletion_requested_at as string | null;
  const purgesAt = requestedAt ? new Date(new Date(requestedAt).getTime() + ACCOUNT_DELETION_GRACE_DAYS * 864e5).toISOString() : null;
  return NextResponse.json({ requestedAt, purgesAt });
}

/** POST — request account deletion. A grace period (not immediate) so a change of mind or a compromised-session mistake is recoverable. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const now = new Date().toISOString();
  const { error } = await supabase.from("profiles").update({ deletion_requested_at: now }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't request deletion." }, { status: 500 });

  await writeAuditLog({ userId: user.id, eventType: "account_deletion_requested", request });
  const purgesAt = new Date(new Date(now).getTime() + ACCOUNT_DELETION_GRACE_DAYS * 864e5).toISOString();
  return NextResponse.json({ ok: true, requestedAt: now, purgesAt });
}

/** DELETE — cancel a pending deletion request. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ deletion_requested_at: null }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't cancel." }, { status: 500 });

  await writeAuditLog({ userId: user.id, eventType: "account_deletion_cancelled", request });
  return NextResponse.json({ ok: true });
}
