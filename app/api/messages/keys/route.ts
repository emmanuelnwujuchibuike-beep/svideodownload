import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ publicKey: z.string().min(1).max(2000) });

/** POST /api/messages/keys — upload this device's Secret Chat ECDH public key (Part 11b). Public by definition — no secret ever touches the server. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const { error } = await supabase.from("user_encryption_keys").upsert(
    { user_id: user.id, public_key: parsed.data.publicKey, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
