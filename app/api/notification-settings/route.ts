import { NextResponse } from "next/server";
import { z } from "zod";

import { getOptionalEmailSetting, setOptionalEmail } from "@/lib/email/consent";
import { getGiftNotifyPrefs, setGiftNotifyPrefs } from "@/lib/gift/notify-prefs";
import { getMessageRequestPrefs, setMessageRequestPrefs } from "@/lib/social/message-request";
import { getMessageEmailSetting, setMessageEmail } from "@/lib/social/message-email";
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
  // 0262: email me new messages — and whether push is on a device (turning email off needs it)
  const [settings, optionalEmail, messageEmail, giftNotify, messageRequest] = await Promise.all([getNotificationSettings(user.id), getOptionalEmailSetting(user.id), getMessageEmailSetting(user.id), getGiftNotifyPrefs(user.id), getMessageRequestPrefs(user.id)]);
  return NextResponse.json({ settings, optionalEmail, messageEmail, giftNotify, messageRequest }, { headers: { "Cache-Control": "private, no-store" } });
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
  // 0262: new-message email on / off — off only while the member has push on a device
  messageEmail: z.boolean().optional(),
  // Frenz Gift Coin Part 4.1 (0294): the two gift switches, each on its own — sending one never changes the other
  giftPush: z.boolean().optional(),
  giftEmail: z.boolean().optional(),
  // 0295: the two message-request switches, each on its own
  messageRequestPush: z.boolean().optional(),
  messageRequestEmail: z.boolean().optional(),
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
  const { optionalEmail, messageEmail, giftPush, giftEmail, messageRequestPush, messageRequestEmail, ...rest } = parsed.data;
  const onlyThese = (n: number) => Object.keys(rest).length === 0 && optionalEmail === undefined && messageEmail === undefined && n === 0;
  if (messageRequestPush !== undefined || messageRequestEmail !== undefined) {
    const r = await setMessageRequestPrefs(user.id, { push: messageRequestPush, email: messageRequestEmail });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    // a request that only changes message-request switches is done: the other settings are untouched
    if (onlyThese(giftPush === undefined && giftEmail === undefined ? 0 : 1)) return NextResponse.json({ ok: true });
  }
  if (giftPush !== undefined || giftEmail !== undefined) {
    const g = await setGiftNotifyPrefs(user.id, { push: giftPush, email: giftEmail });
    if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
    // a request that only changes gift switches is done: the other settings are untouched
    if (Object.keys(rest).length === 0 && optionalEmail === undefined && messageEmail === undefined) return NextResponse.json({ ok: true });
  }
  if (messageEmail !== undefined) {
    const m = await setMessageEmail(user.id, messageEmail);
    if (!m.ok) return NextResponse.json({ error: m.error, ...(m.status === 409 ? { code: "push_required" } : {}) }, { status: m.status });
  }
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
