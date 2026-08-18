import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { clientId, trackLimiter } from "@/lib/rate-limit";
import { recordSoundPlay } from "@/lib/social/sounds";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/sounds/:id/play — records a play once the Sound Page's waveform
 * player is actually tapped to start (never on mount — see the no-autoplay
 * rule in lib/media/audio-playback.ts). Deduped per (viewer|ip, sound, day)
 * at the DB level, same shape as /api/posts/:id/view.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false }, { status: 400 });

  const { success } = await trackLimiter.limit(clientId(request.headers));
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon */
  }

  const ipHash = createHash("sha256")
    .update(((request.headers.get("x-forwarded-for") ?? "").split(",")[0] || "anon").trim())
    .digest("hex");
  void recordSoundPlay(id, viewerId, ipHash);

  return NextResponse.json({ ok: true });
}
