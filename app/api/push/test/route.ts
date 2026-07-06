import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasWebPush, sendPushToUser } from "@/lib/push/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/push/test — send a test notification to every device the signed-in
 * user has registered. Lets people verify end-to-end delivery (lock screen,
 * browser closed) right after enabling push, instead of waiting for a real
 * like/message to find out it never worked.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!hasWebPush) return NextResponse.json({ error: "Push is not configured." }, { status: 503 });

  const { count } = await createAdminClient()
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (!count) {
    return NextResponse.json({ error: "No devices are subscribed yet." }, { status: 409 });
  }

  await sendPushToUser(user.id, {
    title: "Frenz",
    body: "Notifications are working — this is how they'll arrive, even with the app closed.",
    url: "/notifications",
    tag: "push-test",
  });
  return NextResponse.json({ ok: true, devices: count });
}
