import { after, NextResponse } from "next/server";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { bumpEphemeralCount } from "@/lib/rate-limit";
import { typingPushTarget } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One typing push per sender per chat in this window (owner, 2026-10-18). */
const TYPING_PUSH_WINDOW_SECONDS = 5 * 60;
/** A typing push is only true for a moment — the push service drops it after this rather than deliver it late. */
const TYPING_PUSH_TTL_SECONDS = 60;

/**
 * POST /api/messages/:id/typing — "… is typing" as a push, for a recipient whose app is closed
 * (owner, 2026-10-18: direct chats only, at most once per 5 minutes per sender per chat).
 *
 * The client asks only at the START of a typing burst, only in a direct chat, and only when the
 * other person is not in the app (features/social/typing-privacy.ts) — so this runs once per
 * typing session at most, never per keystroke. The server re-checks everything that matters:
 *   · the 5-minute window FIRST (Redis; no Redis ⇒ no push — a typing push is never worth an
 *     unbounded stream), before any database read;
 *   · then typingPushTarget: direct chat, both active members, no block or messaging restriction
 *     either way, both show typing (Ghost Mode), recipient hasn't muted the chat.
 * Delivery is the ordinary message pipeline at MEDIUM priority (quiet hours and the member's
 * switches apply), with the chat's own collapse tag so the real message REPLACES this
 * notification. No in-app notification row is written for typing.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const n = await bumpEphemeralCount(`typing-push:${id}:${user.id}`, TYPING_PUSH_WINDOW_SECONDS);
  if (n !== 1) return NextResponse.json({ sent: false }, { headers: { "Cache-Control": "no-store" } });

  const target = await typingPushTarget(user.id, id);
  if (!target) return NextResponse.json({ sent: false }, { headers: { "Cache-Control": "no-store" } });

  after(() =>
    sendSmartPush(
      target.recipientId,
      {
        title: target.senderName,
        body: "is typing…",
        genericBody: "is typing…",
        url: `/messages/${id}`,
        icon: target.senderAvatar ?? undefined,
        tag: `msg:${id}`,
        conversationId: id,
        ttlSeconds: TYPING_PUSH_TTL_SECONDS,
      },
      "medium",
      "social",
      "already-recorded",
    ).catch(() => {
      /* a typing push is best-effort */
    }),
  );
  return NextResponse.json({ sent: true }, { headers: { "Cache-Control": "no-store" } });
}
