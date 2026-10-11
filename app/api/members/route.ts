import { NextResponse } from "next/server";
import { z } from "zod";

import { addNote, deleteNote, deleteSponsor, joinFree, leave, removeMember, saveFeedback, saveSponsor, setMemberRole, setRecognition } from "@/lib/creator/membership/server";
import { trackLimiter } from "@/lib/rate-limit";
import { saveSubSettings } from "@/lib/sub/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.string().uuid();
const rating = z.number().int().min(1).max(5).nullable().optional();
const body = z.discriminatedUnion("op", [
  // member side
  z.object({ op: z.literal("join"), creatorId: id }).strict(),
  z.object({ op: z.literal("leave"), creatorId: id }).strict(),
  z.object({ op: z.literal("feedback"), creatorId: id, communication: rating, professionalism: rating, quality: rating, reliability: rating, education: rating, community: rating }).strict(),
  // creator side (the session user IS the creator)
  z.object({ op: z.literal("settings"), priceCents: z.number().int().optional(), step: z.number().int().min(0).max(4).optional(), complete: z.boolean().optional(), active: z.boolean().optional(), open: z.boolean().optional(), welcome: z.string().max(800).nullable().optional() }).strict(),
  z.object({ op: z.literal("role"), memberId: id, role: z.string().max(20) }).strict(),
  z.object({ op: z.literal("remove"), memberId: id }).strict(),
  z.object({ op: z.literal("recognition"), memberId: id, kind: z.string().max(30), on: z.boolean(), shown: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("note"), body: z.string().max(4000), minRole: z.string().max(20) }).strict(),
  z.object({ op: z.literal("note_delete"), id }).strict(),
  z.object({ op: z.literal("sponsor"), name: z.string().max(120), kind: z.string().max(20), url: z.string().max(600).nullable().optional() }).strict(),
  z.object({ op: z.literal("sponsor_delete"), id }).strict(),
]);

/**
 * POST — community and creator-setup writes (Feature 19 · Part 13). Paying for a
 * subscription is /api/sub/checkout; withdrawing SUB money is /api/sub/withdraw.
 * The actor is always the session user: nobody edits another creator's settings.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`members:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const me = user.id;
  const out =
    b.op === "join" ? await joinFree(me, b.creatorId)
    : b.op === "leave" ? await leave(me, b.creatorId)
    : b.op === "feedback" ? await saveFeedback(me, b.creatorId, { communication: b.communication, professionalism: b.professionalism, quality: b.quality, reliability: b.reliability, education: b.education, community: b.community })
    : b.op === "settings" ? await saveSubSettings(me, b)
    : b.op === "role" ? await setMemberRole(me, b.memberId, b.role)
    : b.op === "remove" ? await removeMember(me, b.memberId)
    : b.op === "recognition" ? await setRecognition(me, b.memberId, b.kind, b.on, b.shown)
    : b.op === "note" ? await addNote(me, b.body, b.minRole)
    : b.op === "note_delete" ? await deleteNote(me, b.id)
    : b.op === "sponsor" ? await saveSponsor(me, b)
    : await deleteSponsor(me, b.id);
  return out.ok ? NextResponse.json(out) : NextResponse.json({ ok: false, error: out.error, reason: out.reason }, { status: out.status });
}
