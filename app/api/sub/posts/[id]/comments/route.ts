import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { addComment, deleteComment, listComments } from "@/lib/sub/interactions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const headers = { "Cache-Control": "private, no-store" };

async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** GET — the comments on a private post (subscribers and the creator only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const out = await listComments(id, await me());
  return out.ok ? NextResponse.json(out, { headers }) : NextResponse.json({ error: out.error, ...("code" in out && out.code ? { code: out.code } : {}) }, { status: out.status, headers });
}

/** POST { body } — add a comment. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const uid = await me();
  if (uid) {
    const { success } = await trackLimiter.limit(`sub-comment:${uid}`);
    if (!success) return NextResponse.json({ error: "Too many comments — try again in a moment." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { body?: unknown } | null;
  if (typeof body?.body !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await addComment(id, uid, body.body);
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error, ...("code" in out && out.code ? { code: out.code } : {}) }, { status: out.status });
}

/** DELETE { commentId } — your own comment, or any comment on your own post. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { commentId?: unknown } | null;
  if (!UUID.test(id) || typeof body?.commentId !== "string" || !UUID.test(body.commentId)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await deleteComment(id, body.commentId, await me());
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error, ...("code" in out && out.code ? { code: out.code } : {}) }, { status: out.status });
}
