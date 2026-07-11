import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  conversationId: z.string().uuid().optional(),
  clientId: z.string().max(100).optional(),
  reason: z.string().max(200).optional(),
  attempts: z.number().int().min(0).max(1000).optional(),
});

/**
 * POST /api/messages/send-failures — best-effort log of a message that
 * exhausted offline-queue retries (see lib/offline/message-queue.ts). The
 * real, honest version of "dead letter queue" data at this app's scale: a
 * genuine persisted record so the monitoring view's retry/error numbers are
 * real, not placeholders. Never blocks the client — always 204, even on a
 * bad body, since this is telemetry, not a user-facing action.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 204 });

  const { success } = await trackLimiter.limit(`send-fail:${user.id}`);
  if (!success) return new Response(null, { status: 204 });

  try {
    const json = await request.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) return new Response(null, { status: 204 });

    const db = createAdminClient();

    // Writes go through the admin client (bypasses RLS), so `conversationId`
    // itself isn't otherwise checked — verify membership before persisting
    // it rather than trusting an arbitrary client-supplied id.
    let conversationId: string | null = null;
    if (parsed.data.conversationId) {
      const { data: membership } = await db
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", parsed.data.conversationId)
        .eq("user_id", user.id)
        .is("left_at", null)
        .maybeSingle();
      if (membership) conversationId = parsed.data.conversationId;
    }

    await db.from("message_send_failures").insert({
      user_id: user.id,
      conversation_id: conversationId,
      client_id: parsed.data.clientId ?? null,
      reason: parsed.data.reason ?? null,
      attempts: parsed.data.attempts ?? 1,
    });
  } catch {
    /* telemetry is best-effort */
  }
  return new Response(null, { status: 204 });
}
