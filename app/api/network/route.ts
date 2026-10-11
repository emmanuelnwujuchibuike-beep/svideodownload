import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import {
  decideRecommendation,
  deleteOpportunity,
  removeEndorsementOfMe,
  requestConnection,
  respondConnection,
  saveOpportunity,
  saveProfessional,
  setEndorsement,
  writeRecommendation,
} from "@/lib/social/professional/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.string().uuid();
const text = (max: number) => z.string().max(max).nullable().optional();
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("profile"), openTo: z.array(z.string().max(20)).max(10).optional(), industry: text(120) }).strict(),
  z.object({ op: z.literal("request"), targetId: id, theirRole: z.string().max(20), myRole: z.string().max(20), customLabel: text(80), context: text(160), note: text(600) }).strict(),
  z.object({ op: z.literal("respond"), id, action: z.enum(["accept", "decline", "withdraw", "end"]) }).strict(),
  z.object({ op: z.literal("recommend"), subjectId: id, kind: z.string().max(20), body: z.string().max(3000) }).strict(),
  z.object({ op: z.literal("decide"), id, action: z.enum(["show", "hide", "delete"]) }).strict(),
  z.object({ op: z.literal("endorse"), subjectId: id, skill: z.string().min(1).max(40), on: z.boolean() }).strict(),
  z.object({ op: z.literal("unendorse_me"), endorserId: id, skill: z.string().min(1).max(40) }).strict(),
  z.object({ op: z.literal("opportunity"), id: id.optional(), kind: z.string().max(20).optional(), title: z.string().max(200).optional(), description: text(3000), location: text(160), remote: z.boolean().optional(), link: text(600), status: z.enum(["open", "closed"]).optional() }).strict(),
  z.object({ op: z.literal("opportunity_delete"), id }).strict(),
]);

/**
 * POST — every Professional Network write (Feature 19 · Part 12). The actor is
 * always the session user. lib/social/professional/server.ts checks blocks,
 * visibility, and each write's own rule.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`network:${user.id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const out =
    b.op === "profile" ? await saveProfessional(user.id, { openTo: b.openTo, industry: b.industry })
    : b.op === "request" ? await requestConnection(user.id, b)
    : b.op === "respond" ? await respondConnection(user.id, b.id, b.action)
    : b.op === "recommend" ? await writeRecommendation(user.id, b)
    : b.op === "decide" ? await decideRecommendation(user.id, b.id, b.action)
    : b.op === "endorse" ? await setEndorsement(user.id, b)
    : b.op === "unendorse_me" ? await removeEndorsementOfMe(user.id, b.endorserId, b.skill)
    : b.op === "opportunity" ? await saveOpportunity(user.id, { id: b.id, status: b.status, kind: b.kind ?? "", title: b.title ?? "", description: b.description, location: b.location, remote: b.remote, link: b.link })
    : await deleteOpportunity(user.id, b.id);
  return out.ok ? NextResponse.json(out) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
