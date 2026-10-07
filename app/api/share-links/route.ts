import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateShareLink, SHARE_CONTENT_TYPES } from "@/lib/referrals/server";
import { metadataLimiter } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ contentType: z.enum(SHARE_CONTENT_TYPES as unknown as [string, ...string[]]), contentId: z.string().trim().min(1).max(80) }).strict();

/**
 * POST /api/share-links — the member's Frenzsave link for one of THEIR things
 * (rewards brief §6–§7). The owner is the session; ownership of the content is
 * checked on the server; the answer is a URL with a random token, the same one
 * every time for the same content. Sharing it externally counts for referral
 * attribution; the +3 AI-video reward is only for publishing an AI video to
 * Reels through Frenz AI (POST /api/ai/jobs/[id]/publish), never for a link.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to share." }, { status: 401 });
  const burst = await metadataLimiter.limit(`share-link:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too fast — slow down." }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const contentId = parsed.data.contentType === "profile" ? user.id : parsed.data.contentId;
  const out = await getOrCreateShareLink(user.id, parsed.data.contentType as Parameters<typeof getOrCreateShareLink>[1], contentId);
  if (!out.ok) return NextResponse.json({ error: out.reason === "not_yours" ? "You can only share your own content." : "Couldn't make a link. Try again." }, { status: out.reason === "not_yours" ? 403 : 503 });
  const base = SITE_URL || new URL(request.url).origin;
  return NextResponse.json({ url: `${base}/r/${out.token}`, token: out.token });
}
