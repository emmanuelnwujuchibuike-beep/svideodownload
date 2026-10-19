import { after, NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { decodeSubCursor } from "@/lib/sub/guards";
import { createSubPost, listSubPosts } from "@/lib/sub/posts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** GET ?creator=&before= — a creator's SUB POSTS gallery: covers and counts for everyone, captions only for subscribers. Never a media URL. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const creator = url.searchParams.get("creator") ?? "";
  const before = url.searchParams.get("before");
  // Part 3: "before" is the opaque keyset cursor from the previous page (a bare timestamp is still accepted)
  if (!UUID.test(creator) || decodeSubCursor(before) === "invalid") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let out = await listSubPosts(creator, user?.id ?? null, before);
  /*
    Self-heal (2026-10-12): a signed-in viewer without access who has their OWN unsettled
    purchase for this creator — paid at Paystack, but the webhook and the return page both
    missed it — is confirmed with Paystack right now, so the tab they're looking at unlocks
    instead of asking them to pay again. One indexed read when there is nothing pending.
  */
  if (user && !out.access && !out.isCreator && !before) {
    const { settleOwnPendingSub } = await import("@/lib/sub/server");
    if (await settleOwnPendingSub(user.id, creator).catch(() => false)) out = await listSubPosts(creator, user.id, before);
  }
  // per viewer: what a subscriber sees must never be cached for anyone else
  return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

const body = z
  .object({
    caption: z.string().max(4400).nullable().optional(),
    coverUrl: z.string().max(600).nullable().optional(),
    media: z.array(z.object({ key: z.string().max(300), kind: z.enum(["image", "video"]), width: z.number().int().positive().max(20000).nullable().optional(), height: z.number().int().positive().max(20000).nullable().optional(), thumbKey: z.string().max(300).optional() }).strict()).min(1).max(10),
    // 0248: locked (default) = non-subscribers see the public tile; hidden = they get nothing at all
    audience: z.enum(["locked", "hidden"]).optional(),
    // 0261: Mature (18+) — only viewers who confirmed they're 18+ can open it; explicit content is never allowed
    mature: z.boolean().optional(),
  })
  .strict();

/** POST — publish a subscriber-only post. Only files from the creator's own private folder. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`sub-post:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const out = await createSubPost(user.id, parsed.data);
  // everyone who asked to hear about this creator's private posts — after the response, never in its way
  // a hidden post is announced to active subscribers only (Part 3)
  if (out.ok) {
    const postId = out.id;
    const audience = out.audience;
    /*
      Part 6: the alert fan-out is a job (0251) — bounded pages, every recipient claimed once,
      eligibility re-read at send time. Before 0251 runs, the older direct path is used.
    */
    after(async () => {
      const { enqueueFanout, startFanout } = await import("@/lib/sub/fanout");
      const jobId = await enqueueFanout("private_post", postId, user.id);
      if (jobId) return startFanout(jobId);
      const { notifyNewPrivatePost } = await import("@/lib/sub/private-notify");
      return notifyNewPrivatePost(user.id, { audience });
    });
  }
  // 0261: "age_required" tells the composer to show the age check
  return out.ok ? NextResponse.json(out) : NextResponse.json({ ok: false, error: out.error, ...("code" in out && out.code ? { code: out.code } : {}) }, { status: out.status });
}
