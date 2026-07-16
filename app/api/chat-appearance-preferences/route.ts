import { NextResponse } from "next/server";
import { z } from "zod";

import {
  BUBBLE_STYLES,
  FONT_STYLES,
  fromChatAppearanceRow,
  isHexColor,
  type ChatAppearanceRow,
} from "@/lib/social/chat-appearance";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  // Which conversation this appearance belongs to (owner ask 2026-07-16:
  // appearance is per-CHAT now, not global) — required for both read and write.
  conversationId: z.string().regex(UUID),
  // API/TS field is `fontStyle` (a typeface choice); the underlying DB
  // column stays `font_size` (see chat-appearance.ts's doc comment) to
  // avoid a rename. No value CHECK in the DB — this enum is the source of truth.
  fontStyle: z.enum(FONT_STYLES).optional(),
  bubbleStyle: z.enum(BUBBLE_STYLES).optional(),
  // Explicit `null` clears back to the default (falls back to the
  // conversation theme); omitted leaves whatever's already saved untouched.
  bubbleColor: z.union([z.string().refine(isHexColor, "Invalid color."), z.null()]).optional(),
  // The "Only you" wallpaper scope (migration 0080). Explicit `null` clears it,
  // falling back to the conversation's shared wallpaper; omitted leaves it
  // untouched. Validated the same way as the shared wallpaper on
  // /api/conversations/[id] — a well-formed URL, no origin allowlist. Lower
  // risk than the shared one: this row is per-user and RLS-scoped to its owner,
  // so the only person who can ever see a URL set here is the person who set
  // it. (Tightening BOTH to a storage-origin allowlist is worth doing, but it
  // belongs in one pass over both routes, not half-applied here.)
  wallpaperUrl: z.union([z.string().url().max(2048), z.null()]).optional(),
});

/** GET /api/chat-appearance-preferences?conversationId=… — the viewer's personal appearance for ONE chat. */
export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get("conversationId") ?? "";
  if (!UUID.test(conversationId)) {
    return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data } = await supabase
    .from("chat_appearance_preferences")
    .select("*")
    .eq("user_id", user.id)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  return NextResponse.json({ appearance: fromChatAppearanceRow(data as ChatAppearanceRow | null) });
}

/** PATCH /api/chat-appearance-preferences — partial update for ONE chat, merged with whatever's already saved. */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences." }, { status: 400 });
  const { conversationId } = parsed.data;

  const { data: existing } = await supabase
    .from("chat_appearance_preferences")
    .select("*")
    .eq("user_id", user.id)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  const current = fromChatAppearanceRow(existing as ChatAppearanceRow | null);
  const merged = {
    fontStyle: parsed.data.fontStyle ?? current.fontStyle,
    bubbleStyle: parsed.data.bubbleStyle ?? current.bubbleStyle,
    bubbleColor: parsed.data.bubbleColor !== undefined ? parsed.data.bubbleColor : current.bubbleColor,
    wallpaperUrl: parsed.data.wallpaperUrl !== undefined ? parsed.data.wallpaperUrl : current.wallpaperUrl,
  };

  const { error } = await supabase.from("chat_appearance_preferences").upsert(
    {
      user_id: user.id,
      conversation_id: conversationId,
      font_size: merged.fontStyle,
      bubble_style: merged.bubbleStyle,
      bubble_color: merged.bubbleColor,
      wallpaper_url: merged.wallpaperUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,conversation_id" },
  );
  if (error) {
    // Migration 0080 (wallpaper_url) may not be applied yet. Rather than fail
    // the whole save — which would also break the font/bubble settings that
    // have nothing to do with wallpaper — retry without the new column. Same
    // "a missing column costs only its own feature" stance the SSR read and
    // /api/stories' `format` insert already take.
    if (error.code === "42703") {
      const { error: retry } = await supabase.from("chat_appearance_preferences").upsert(
        {
          user_id: user.id,
          conversation_id: conversationId,
          font_size: merged.fontStyle,
          bubble_style: merged.bubbleStyle,
          bubble_color: merged.bubbleColor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,conversation_id" },
      );
      if (retry) return NextResponse.json({ error: "Couldn't save preferences." }, { status: 500 });
      return NextResponse.json({ appearance: { ...merged, wallpaperUrl: null } });
    }
    return NextResponse.json({ error: "Couldn't save preferences." }, { status: 500 });
  }

  return NextResponse.json({ appearance: merged });
}
