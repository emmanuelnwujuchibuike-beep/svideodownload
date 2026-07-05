import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const vis = z.enum(["public", "followers", "private"]);
const policy = z.enum(["everyone", "followers", "off"]);

const schema = z.object({
  activity_visibility: vis.optional(),
  followers_visibility: vis.optional(),
  reposts_visibility: vis.optional(),
  likes_visibility: vis.optional(),
  saves_visibility: vis.optional(),
  comments_policy: policy.optional(),
  messages_policy: policy.optional(),
  allow_indexing: z.boolean().optional(),
  show_in_recommendations: z.boolean().optional(),
});

/** PATCH /api/privacy — upsert the signed-in user's privacy settings. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid privacy settings." }, { status: 400 });
  }

  const { error } = await supabase
    .from("privacy_settings")
    .upsert(
      { user_id: user.id, ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) return NextResponse.json({ error: "Couldn't save settings." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
