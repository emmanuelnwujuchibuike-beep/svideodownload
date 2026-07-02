import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** POST /api/push/subscribe — register this browser's push subscription. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = subSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });

  const { endpoint, keys } = parsed.data;
  // Upsert on the unique endpoint so re-subscribing the same browser is idempotent
  // and re-homes the endpoint to the current user. Must run as service role: the
  // conflict UPDATE path has no RLS policy (and the existing row may belong to a
  // previous account on this browser), so an RLS upsert would 500 on re-subscribe.
  const { error } = await createAdminClient().from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: "Couldn't subscribe." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/push/subscribe — remove this browser's subscription. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let endpoint: string | undefined;
  try {
    ({ endpoint } = (await request.json()) as { endpoint?: string });
  } catch {
    /* fall through */
  }
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });

  await supabase.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
