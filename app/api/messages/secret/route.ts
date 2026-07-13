import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateSecretConversation, listSecretConversations } from "@/lib/social/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ recipientId: z.string().uuid() });

/** GET /api/messages/secret — the signed-in user's Secret Chats list. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ conversations: [] });
  const conversations = await listSecretConversations(user.id);
  return NextResponse.json({ conversations });
}

/**
 * POST /api/messages/secret — get-or-create a Secret Chat with another user
 * (Part 11b). Requires BOTH participants to have already uploaded an
 * encryption public key — the caller's own missing key is checked
 * client-side (ensureIdentityKey() runs before this is ever called); the
 * RECIPIENT'S key can only be checked here, server-side.
 */
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
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const admin = createAdminClient();
  const { data: recipientKey } = await admin
    .from("user_encryption_keys")
    .select("user_id")
    .eq("user_id", parsed.data.recipientId)
    .maybeSingle();
  if (!recipientKey) {
    return NextResponse.json({ error: "That person hasn't set up Secret Chats yet." }, { status: 409 });
  }

  const res = await getOrCreateSecretConversation(user.id, parsed.data.recipientId);
  if (!res.ok) return NextResponse.json({ error: "Couldn't start a Secret Chat (blocked or unavailable)." }, { status: 400 });
  return NextResponse.json({ ok: true, id: res.id });
}
