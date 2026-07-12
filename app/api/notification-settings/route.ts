import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { DEFAULT_NOTIFICATION_SETTINGS, getNotificationSettings, setNotificationSettings } from "@/lib/social/notification-settings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notification-settings — the signed-in user's Part 6 notification settings. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ settings: DEFAULT_NOTIFICATION_SETTINGS });

  const settings = await getNotificationSettings(user.id);
  return NextResponse.json({ settings }, { headers: { "Cache-Control": "private, no-store" } });
}

const categoryPrefSchema = z.object({
  enabled: z.boolean(),
  push: z.boolean(),
  alwaysDeliver: z.boolean().optional(),
});

const schema = z.object({
  masterEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  categoryPrefs: z.record(z.string(), categoryPrefSchema).optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStartUtc: z.number().int().min(0).max(23).optional(),
  quietHoursEndUtc: z.number().int().min(0).max(23).optional(),
  hidePushPreview: z.boolean().optional(),
});

/** PATCH /api/notification-settings — update one or more settings (merges into existing category_prefs). */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await trackLimiter.limit(`notif-settings:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid settings." }, { status: 400 });

  const res = await setNotificationSettings(user.id, parsed.data);
  if (!res.ok) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
