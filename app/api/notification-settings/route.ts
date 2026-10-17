import { NextResponse } from "next/server";
import { z } from "zod";

import { getOptionalEmailSetting, setOptionalEmail } from "@/lib/email/consent";
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

  // Part 11 (0253): the global optional-email switch rides beside the settings, read on its own so a
  // database without the column still answers everything else unchanged
  const [settings, optionalEmail] = await Promise.all([getNotificationSettings(user.id), getOptionalEmailSetting(user.id)]);
  return NextResponse.json({ settings, optionalEmail }, { headers: { "Cache-Control": "private, no-store" } });
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
  // was missing: the Daily digest switch on /account never saved (zod drops unknown keys)
  digestEnabled: z.boolean().optional(),
  // Feature 20 (0233): Smart delivery
  quietHoursTz: z.string().min(1).max(64).nullable().optional(),
  heldSummaryEnabled: z.boolean().optional(),
  favoritesBypassQuiet: z.boolean().optional(),
  // Feature 20 Part 5 (0236): Delivery Rules (re-validated by cleanRules) and lock-screen privacy
  rules: z.array(z.unknown()).max(30).optional(),
  lockScreen: z.enum(["full", "no_preview", "hidden"]).optional(),
  // Part 11 (0253): optional product email on / off — the SESSION user's own row only
  optionalEmail: z.boolean().optional(),
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

  /*
    Part 5 "Reset to defaults": every switch back to the default, every category the member
    had changed back to on, no rules — one write. (A plain patch merges categories, so the
    reset names each one the member had set.)
  */
  if ((json as { reset?: unknown } | null)?.reset === true) {
    const current = await getNotificationSettings(user.id);
    const { lastDigestSentAt: _system, categoryPrefs: _c, ...defaults } = DEFAULT_NOTIFICATION_SETTINGS;
    const categoryPrefs = Object.fromEntries(Object.keys(current.categoryPrefs).map((k) => [k, { enabled: true, push: true }]));
    const out = await setNotificationSettings(user.id, { ...defaults, categoryPrefs });
    return out.ok || out.pending ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't reset." }, { status: 500 });
  }
  const { optionalEmail, ...rest } = parsed.data;
  if (optionalEmail !== undefined) {
    const e = await setOptionalEmail(user.id, optionalEmail);
    if (e.pending) return NextResponse.json({ error: "The email switch arrives with the next update." }, { status: 503 });
    if (!e.ok) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  }
  const res = await setNotificationSettings(user.id, rest);
  if (res.pending) return NextResponse.json({ error: "Smart delivery arrives with the next update." }, { status: 503 });
  if (!res.ok) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
