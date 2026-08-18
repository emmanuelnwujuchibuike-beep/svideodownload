import { NextResponse } from "next/server";

import { getSound } from "@/lib/social/sounds";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/sounds/:id — a sound's basic info, e.g. for the Reel composer's
 *  "sound attached" chip after arriving from a Sound Page's "Use this sound". */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  const sound = await getSound(id, viewerId);
  if (!sound) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: sound.id,
    title: sound.title,
    artistLabel: sound.artistLabel,
    coverArtUrl: sound.coverArtUrl,
    sourceType: sound.sourceType,
    sourcePlatform: sound.sourcePlatform,
  });
}
