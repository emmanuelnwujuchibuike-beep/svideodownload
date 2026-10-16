import { after, NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { createAnnouncement, deleteAnnouncement, listAnnouncements } from "@/lib/sub/announcements";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const UUID = /^[0-9a-f-]{36}$/i;

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * GET ?creator=&cursor= — a creator's subscriber announcements (Frenz Exclusive Part 6). The
 * creator sees their own with delivery counts; anyone else must be an active subscriber right
 * now, or gets `access: false` and nothing else.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const creator = params.get("creator") ?? "";
  if (!UUID.test(creator)) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: HEADERS });
  const user = await sessionUser();
  if (user) {
    const { success } = await trackLimiter.limit(`sub-ann-read:${user.id}`);
    if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: HEADERS });
  }
  const out = await listAnnouncements(user?.id ?? null, creator, params.get("cursor"));
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: HEADERS });
  return NextResponse.json({ access: out.access, items: out.items, next: out.next }, { headers: HEADERS });
}

/**
 * POST { title, body, idempotencyKey } — publish to YOUR subscribers (the creator is the session
 * user). A retry with the same key returns the same announcement. The first recipient pages go
 * out after the response; the rest in the 10-minute reconcile run.
 */
export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401, headers: HEADERS });
  const { success } = await trackLimiter.limit(`sub-ann-post:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429, headers: HEADERS });
  const parsed = z.object({ title: z.string().max(200), body: z.string().max(4000), idempotencyKey: z.string().max(80) }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400, headers: HEADERS });
  const out = await createAnnouncement(user.id, parsed.data);
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error, reason: out.reason }, { status: out.status, headers: HEADERS });
  if (out.jobId && !out.duplicate) {
    const jobId = out.jobId;
    after(() => import("@/lib/sub/fanout").then((m) => m.startFanout(jobId)));
  }
  return NextResponse.json({ ok: true, announcement: out.announcement, duplicate: out.duplicate, queued: !!out.jobId }, { headers: HEADERS });
}

/** DELETE ?id= — remove one of YOUR announcements (kept for audit, hidden from subscribers, fan-out stopped). */
export async function DELETE(request: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401, headers: HEADERS });
  const { success } = await trackLimiter.limit(`sub-ann-post:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429, headers: HEADERS });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400, headers: HEADERS });
  const out = await deleteAnnouncement(user.id, id);
  return out.ok ? NextResponse.json({ ok: true }, { headers: HEADERS }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status, headers: HEADERS });
}
