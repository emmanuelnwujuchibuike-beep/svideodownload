import { NextResponse } from "next/server";

import { checkNewDevice, RECENT_LOGIN_WINDOW_MS, type SessionRow } from "@/lib/auth/device-check";
import { upsertTrustedDevice } from "@/lib/auth/devices";
import { trackLimiter } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { decodeSessionId } from "@/lib/auth/session-jwt";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/device-check — called once per browser session (see
 * `features/app-shell/device-check.tsx`) right after the authenticated app
 * shell mounts. A same-origin fetch from the real browser, so the
 * `user-agent` header here is the actual device's — see the long comment in
 * `lib/auth/device-check.ts` for why this can't be done from inside the
 * server-side OAuth/magic-link routes instead. Always 200s (best-effort);
 * never something a caller needs to retry or handle specially.
 *
 * Rate-limited per user (not per IP — a browser can't be made to lie about
 * its own `User-Agent`, but nothing stops a direct HTTP client with a valid
 * session cookie from POSTing repeatedly with a different spoofed header
 * each time, generating unbounded `security_new_device` notifications/push
 * sends against the caller's own account). Same limiter `/api/report` already
 * uses for the analogous concern.
 *
 * Part 11a addition: also opportunistically upserts this browser's
 * `trusted_devices` row (device naming/trust — see lib/auth/devices.ts) and
 * writes `security_audit_log` rows for `login` (evidence a sign-in just
 * happened — same recent-session heuristic `checkNewDevice` already uses)
 * and `device_added` (when a new-device alert actually fires).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { success } = await trackLimiter.limit(`device-check:${user.id}`);
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  const userAgent = request.headers.get("user-agent");

  // Fetched ONCE and shared with checkNewDevice (rather than each fetching
  // its own copy of the same RPC) — this route already chains several DB
  // calls per invocation, and this was a genuinely duplicate round trip.
  const admin = createAdminClient();
  const { data: rawRows } = await admin.rpc("list_user_sessions", { p_user_id: user.id });
  const sessionRows = (rawRows ?? []) as SessionRow[];

  const notified = await checkNewDevice(user.id, userAgent, sessionRows);

  // Best-effort side channel, deliberately isolated from checkNewDevice's
  // own return value — a failure here must never affect the notification
  // path above, which already shipped and is tested independently.
  try {
    const { data: session } = await supabase.auth.getSession();
    const sessionId = session.session ? decodeSessionId(session.session.access_token) : null;

    const isRecent = (r: SessionRow) => Date.now() - +new Date(r.created_at) <= RECENT_LOGIN_WINDOW_MS;
    const justLoggedIn = sessionRows.some(isRecent);

    // upsertTrustedDevice and the "was there a recent login" dedupe check
    // don't depend on each other — run them concurrently.
    const [, recentLoginAudit] = await Promise.all([
      upsertTrustedDevice(user.id, sessionId, userAgent),
      justLoggedIn
        ? admin
            .from("security_audit_log")
            .select("id")
            .eq("user_id", user.id)
            .eq("event_type", "login")
            .gte("created_at", new Date(Date.now() - RECENT_LOGIN_WINDOW_MS).toISOString())
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // Dedupe: a PWA relaunch or a second tab opened within the same login
    // window would otherwise write a duplicate "Signed in" row per tab —
    // sessionStorage's once-per-session gate in the client bootstrap is
    // per-tab, not per-browser-session, so this DB-side check is the real
    // backstop (same pattern security_new_device's own dedupe already uses).
    if (justLoggedIn && !recentLoginAudit.data) {
      await writeAuditLog({ userId: user.id, eventType: "login", request });
    }
    if (notified) {
      await writeAuditLog({ userId: user.id, eventType: "device_added", request });
    }
  } catch {
    /* best-effort — never affects the response below */
  }

  return NextResponse.json({ ok: true, notified });
}
