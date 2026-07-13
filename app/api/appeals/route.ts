import { NextResponse } from "next/server";
import { z } from "zod";

import { listAppealableItems, listOwnAppeals, submitAppeal } from "@/lib/social/appeals";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  targetType: z.enum(["post", "comment", "user"]),
  targetId: z.string().uuid(),
  message: z.string().trim().min(1).max(1000),
});

/** GET /api/appeals — the viewer's own appealable items + their appeal history. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const [appealable, history] = await Promise.all([listAppealableItems(user.id), listOwnAppeals(user.id)]);
  return NextResponse.json({ appealable, history });
}

/** POST /api/appeals — submit an appeal for the viewer's own actioned content/account. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await trackLimiter.limit(`appeal:${clientId(request.headers)}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid appeal." }, { status: 400 });

  const res = await submitAppeal(user.id, parsed.data.targetType, parsed.data.targetId, parsed.data.message);
  if (!res.ok) {
    const messages: Record<string, string> = {
      not_yours: "That isn't your content.",
      not_actioned: "That item hasn't been actioned.",
      already_pending: "You already have a pending appeal for this.",
      unavailable: "Couldn't submit your appeal.",
    };
    return NextResponse.json({ error: messages[res.reason] ?? "Couldn't submit your appeal." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
