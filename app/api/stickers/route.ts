import { NextResponse } from "next/server";
import { z } from "zod";

import { isStickerId } from "@/lib/social/stickers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/stickers — the signed-in member's saved sticker ids. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ saved: [] });

  try {
    const { data } = await supabase
      .from("user_stickers")
      .select("sticker")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    return NextResponse.json(
      { saved: ((data ?? []) as { sticker: string }[]).map((r) => r.sticker) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ saved: [] });
  }
}

const schema = z.object({ sticker: z.string().max(40) });

/** POST /api/stickers — save a sticker to your collection. */
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
  const parsed = schema.safeParse(body);
  if (!parsed.success || !isStickerId(parsed.data.sticker)) {
    return NextResponse.json({ error: "Unknown sticker." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_stickers")
    .upsert({ user_id: user.id, sticker: parsed.data.sticker }, { onConflict: "user_id,sticker", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: "Couldn't save sticker." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/stickers?sticker=id — remove a saved sticker. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const sticker = new URL(request.url).searchParams.get("sticker") ?? "";
  if (!sticker) return NextResponse.json({ error: "Missing sticker." }, { status: 400 });

  const { error } = await supabase.from("user_stickers").delete().eq("user_id", user.id).eq("sticker", sticker);
  if (error) return NextResponse.json({ error: "Couldn't remove sticker." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
