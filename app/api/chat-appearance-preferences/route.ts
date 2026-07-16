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

const schema = z.object({
  // API/TS field is `fontStyle` (a typeface choice); the underlying DB
  // column stays `font_size` (see chat-appearance.ts's doc comment) to
  // avoid a migration.
  fontStyle: z.enum(FONT_STYLES).optional(),
  bubbleStyle: z.enum(BUBBLE_STYLES).optional(),
  // Explicit `null` clears back to the default (falls back to the
  // conversation theme); omitted leaves whatever's already saved untouched.
  bubbleColor: z.union([z.string().refine(isHexColor, "Invalid color."), z.null()]).optional(),
});

/** GET /api/chat-appearance-preferences — the signed-in viewer's personal font-style/bubble prefs. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data } = await supabase
    .from("chat_appearance_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ appearance: fromChatAppearanceRow(data as ChatAppearanceRow | null) });
}

/** PATCH /api/chat-appearance-preferences — partial update, merged with whatever's already saved. */
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

  const { data: existing } = await supabase
    .from("chat_appearance_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const current = fromChatAppearanceRow(existing as ChatAppearanceRow | null);
  const merged = {
    fontStyle: parsed.data.fontStyle ?? current.fontStyle,
    bubbleStyle: parsed.data.bubbleStyle ?? current.bubbleStyle,
    bubbleColor: parsed.data.bubbleColor !== undefined ? parsed.data.bubbleColor : current.bubbleColor,
  };

  const { error } = await supabase.from("chat_appearance_preferences").upsert(
    {
      user_id: user.id,
      font_size: merged.fontStyle,
      bubble_style: merged.bubbleStyle,
      bubble_color: merged.bubbleColor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return NextResponse.json({ error: "Couldn't save preferences." }, { status: 500 });

  return NextResponse.json({ appearance: merged });
}
