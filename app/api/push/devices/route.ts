import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { deviceName } from "@/lib/push/device-name";
import { sendPushToDevice } from "@/lib/push/web-push";
import { trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE DEVICE MANAGER (Feature 20 Part 6) — the devices that get this member's notifications.
 *
 *   GET     every push-registered device: a recognisable name, the member's own label, when it
 *           joined, and its LAST delivery (sent / retried / failed / pruned, and when) with 7-day
 *           counts — the honest answer to "why didn't I get it?"
 *   PATCH   { id, label }      rename
 *   POST    { id }             send a test notification to that one device
 *   DELETE  { id }             stop notifications on that device (removes its subscription)
 *
 * Never returns an endpoint or a key: `key` is a short hash of the endpoint, so the page can
 * tell "this device" from the browser's own subscription without the server handing it out.
 * Every write is scoped to the signed-in member's own rows (service role + user_id filter).
 * Sign-in sessions are a different list — /account/devices.
 */
async function member() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

const keyOf = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
const UUID = z.string().uuid();

export async function GET() {
  const user = await member();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = createAdminClient();
  let subs = await db.from("push_subscriptions").select("id, endpoint, user_agent, created_at, label").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
  if (subs.error) subs = (await db.from("push_subscriptions").select("id, endpoint, user_agent, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20)) as typeof subs;
  const rows = (subs.data ?? []) as { id: string; endpoint: string; user_agent: string | null; created_at: string; label?: string | null }[];
  const ids = rows.map((r) => r.id);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: log } = ids.length
    ? await db.from("push_delivery_log").select("subscription_id, status, created_at, error").in("subscription_id", ids).gte("created_at", since).order("created_at", { ascending: false }).limit(1000)
    : { data: [] };
  const byDevice = new Map<string, { last: { status: string; at: string } | null; sent: number; failed: number }>();
  for (const l of (log ?? []) as { subscription_id: string; status: string; created_at: string }[]) {
    const d = byDevice.get(l.subscription_id) ?? { last: null, sent: 0, failed: 0 };
    if (!d.last) d.last = { status: l.status, at: l.created_at };
    if (l.status === "sent" || l.status === "retried") d.sent += 1;
    else if (l.status === "failed") d.failed += 1;
    byDevice.set(l.subscription_id, d);
  }
  return NextResponse.json(
    {
      devices: rows.map((r) => {
        const n = deviceName(r.user_agent);
        const d = byDevice.get(r.id) ?? { last: null, sent: 0, failed: 0 };
        return { id: r.id, key: keyOf(r.endpoint), name: n.name, platform: n.platform, label: r.label ?? null, addedAt: r.created_at, last: d.last, sent7d: d.sent, failed7d: d.failed };
      }),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request) {
  const user = await member();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const parsed = z.object({ id: UUID, label: z.string().trim().max(40).nullable() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const label = parsed.data.label && /^[\p{L}\p{N} '’._-]{1,40}$/u.test(parsed.data.label) ? parsed.data.label : null;
  if (parsed.data.label && !label) return NextResponse.json({ error: "Use letters, numbers and spaces." }, { status: 400 });
  const { error } = await createAdminClient().from("push_subscriptions").update({ label }).eq("id", parsed.data.id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: /column/i.test(error.message) ? "Renaming arrives with the next update." : "Couldn't rename it." }, { status: /column/i.test(error.message) ? 503 : 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const user = await member();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`push-device-test:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many tests — try again in a minute." }, { status: 429 });
  const parsed = z.object({ id: UUID }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const db = createAdminClient();
  const { data: own } = await db.from("push_subscriptions").select("id").eq("id", parsed.data.id).eq("user_id", user.id).maybeSingle();
  if (!own) return NextResponse.json({ error: "That device isn't yours." }, { status: 404 });
  // force: shown even when Frenz is open on that device, so the test is visible
  await sendPushToDevice(user.id, parsed.data.id, { title: "Frenz", body: "Test notification — this device is set up.", url: "/account/notifications", tag: "device-test", force: true });
  const { data: last } = await db.from("push_delivery_log").select("status, created_at, error").eq("subscription_id", parsed.data.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const status = (last as { status?: string } | null)?.status ?? "unknown";
  return NextResponse.json({ ok: status === "sent" || status === "retried", status });
}

export async function DELETE(request: Request) {
  const user = await member();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const parsed = z.object({ id: UUID }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { error } = await createAdminClient().from("push_subscriptions").delete().eq("id", parsed.data.id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't remove it." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
