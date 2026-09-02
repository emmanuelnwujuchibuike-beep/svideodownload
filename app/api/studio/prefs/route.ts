import { NextResponse } from "next/server";
import { z } from "zod";

import { setStudioPrefs } from "@/lib/creator/prefs";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/studio/prefs — save the creator's dashboard layout
 * (Feature 15 Part 9).
 *
 * Unknown widget/metric ids are dropped by `setStudioPrefs` rather than
 * rejected here: a client running an older bundle after a widget was renamed
 * would otherwise have every save fail, and losing one card from a layout is a
 * far better outcome than a customiser that silently stops working.
 */
const schema = z.object({
  widgetOrder: z.array(z.string().max(64)).max(50).optional(),
  hiddenWidgets: z.array(z.string().max(64)).max(50).optional(),
  pinnedMetrics: z.array(z.string().max(64)).max(20).optional(),
  accent: z.string().max(32).optional(),
  weeklyGoal: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing valid to update." }, { status: 400 });
  }

  const prefs = await setStudioPrefs(user.id, parsed.data);
  return NextResponse.json({ ok: true, prefs });
}
