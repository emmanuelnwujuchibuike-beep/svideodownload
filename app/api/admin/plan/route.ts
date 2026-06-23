import { NextResponse } from "next/server";
import { z } from "zod";

import { trackEvent } from "@/lib/analytics/events";
import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  plan: z.enum(["free", "pro", "business"]),
});

/**
 * Admin-only: manually grant or remove a plan for a user by email. Creates a
 * `provider: 'manual'` subscription row so getUserPlan() reflects it immediately.
 * Note: this does NOT cancel a real Paystack subscription — use it for comps,
 * support, and manual grants.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a valid email and plan." }, { status: 400 });
  }

  const { email, plan } = parsed.data;
  const db = createAdminClient();

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "No user found with that email." }, { status: 404 });
  }
  const userId = profile.id as string;

  const active = plan !== "free";
  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: userId,
      plan: active ? plan : "free",
      status: active ? "active" : "canceled",
      provider: "manual",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json({ error: "Couldn't update the plan." }, { status: 500 });
  }

  await db.from("profiles").update({ role: active ? "pro" : "user" }).eq("id", userId);

  trackEvent(active ? "subscribe" : "subscribe_cancel", {
    userId,
    metadata: { plan, source: "admin_manual", by: admin.email },
  });

  return NextResponse.json({ ok: true, email, plan });
}
