import { NextResponse } from "next/server";

import { previewSubPost } from "@/lib/sub/posts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * GET — the public face of one exclusive post, for a chat card (0305): the creator, counts, the public cover and the
 * blurred previews, plus whether THIS viewer has access (then the card opens the post through GET /api/sub/posts/[id],
 * which checks the subscription again and mints the links). Never the file or the caption.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const out = await previewSubPost(id, user?.id ?? null);
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  return out.ok ? NextResponse.json(out, { headers }) : NextResponse.json({ error: out.error }, { status: out.status, headers });
}
