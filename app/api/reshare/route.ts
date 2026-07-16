import { NextResponse } from "next/server";
import { z } from "zod";

import { reshare, setReshareAllowed } from "@/lib/social/reshare";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postSchema = z.object({
  source: z.enum(["message", "story"]),
  sourceId: z.string().regex(UUID),
  /** Which attachment of the message — required when source = "message". */
  attachmentId: z.string().regex(UUID).optional(),
  destination: z.enum(["post", "reel", "story", "chat"]),
  caption: z.string().trim().max(300).optional(),
  /** Required when destination = "chat". */
  conversationId: z.string().regex(UUID).optional(),
});

const patchSchema = z.object({
  source: z.enum(["message", "story"]),
  sourceId: z.string().regex(UUID),
  allowReshare: z.boolean(),
});

/**
 * POST /api/reshare — reshare chat media or a story.
 *
 * Every rule (who may reshare what, and where it may go) is decided in
 * lib/social/reshare.ts, never here and never in the UI: a story may only reach
 * another story or a private chat, chat media may reach the feed/Reels/a story,
 * and the original author's `allow_reshare` switch is honoured server-side so a
 * hand-rolled request can't step around it.
 */
export async function POST(request: Request) {
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
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid reshare." }, { status: 400 });

  const result = await reshare({ viewerId: user.id, ...parsed.data });
  if (result.ok) return NextResponse.json({ ok: true, postId: result.postId ?? null, storyId: result.storyId ?? null });

  const status =
    result.reason === "not-allowed"
      ? 403
      : result.reason === "forbidden"
        ? 403
        : result.reason === "not-found"
          ? 404
          : result.reason === "bad-destination"
            ? 400
            : 500;
  const message =
    result.reason === "not-allowed"
      ? "Resharing is turned off for this."
      : result.reason === "forbidden"
        ? "You can't reshare that."
        : result.reason === "not-found"
          ? "That's no longer available."
          : result.reason === "bad-destination"
            ? "That can't be shared there."
            : "Couldn't reshare.";
  return NextResponse.json({ error: message }, { status });
}

/** PATCH /api/reshare — the author's own "allow resharing" switch. */
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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // Authorship is enforced inside setReshareAllowed's WHERE clause, so a
  // non-author's request simply updates zero rows.
  const res = await setReshareAllowed(user.id, parsed.data.source, parsed.data.sourceId, parsed.data.allowReshare);
  if (!res.ok) return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  return NextResponse.json({ ok: true, allowReshare: parsed.data.allowReshare });
}
