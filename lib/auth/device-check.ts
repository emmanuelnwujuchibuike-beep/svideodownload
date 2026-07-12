import { after } from "next/server";

import { parseDevice } from "@/lib/auth/device-label";
import { sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SessionRow {
  id: string;
  created_at: string;
  user_agent: string | null;
}

/** How recently a session must have been CREATED for this visit to count as
 *  "right after a login" — outside this window we never alert, no matter what
 *  the user-agent comparison says (an app re-entry is not a login event). */
export const RECENT_LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * The actual "is this worth alerting about" decision, isolated from the
 * DB/push side effects so it has a real, direct unit test (see
 * `lib/auth/device-check.test.ts`) instead of only a throwaway
 * reimplementation. Exported pure.
 *
 * 2026-07-12 rework (owner bug: "I get a security notification each time I
 * enter the app instead of when I login"): the old version excluded the
 * NEWEST session row and asked "has this UA been seen among the others?" —
 * which is only correct when called immediately after a sign-in (when the
 * newest row IS this device's brand-new session). But this check runs on
 * every app entry (see features/app-shell/device-check.tsx), where no new
 * session was created — so on a 2-device account, whichever device did NOT
 * create the most recent session row got flagged as "new" on EVERY entry,
 * forever. The fix gates on evidence a login actually just happened: some
 * session row created inside RECENT_LOGIN_WINDOW_MS. No recent session →
 * plain re-entry → never alert. With a recent login, alert only if this
 * user-agent doesn't appear on any OLDER (pre-login) session.
 */
export function shouldAlertForNewDevice(rows: SessionRow[], currentUserAgent: string | null, now = Date.now()): boolean {
  if (!currentUserAgent) return false;
  // Only one (or zero) session on record — either the very first sign-in
  // ever, or a fresh account. Nothing to compare against yet; alerting here
  // would just be noise on account creation, not a real "new device" event.
  if (rows.length <= 1) return false;

  const isRecent = (r: SessionRow) => now - +new Date(r.created_at) <= RECENT_LOGIN_WINDOW_MS;
  if (!rows.some(isRecent)) return false; // no login just happened — this is an app re-entry
  const older = rows.filter((r) => !isRecent(r));
  if (older.length === 0) return false; // every session is brand new — account creation, not a new device
  const seenBefore = older.some((r) => r.user_agent === currentUserAgent);
  return !seenBefore;
}

/**
 * Wires the previously reserved-but-dead `security_new_device` notification
 * type (confirmed: declared in the `NotificationType` union, in the DB check
 * constraint, and rendered by `features/notifications/meta.tsx` — but never
 * once actually inserted anywhere, the same "reserved, never wired" pattern
 * [[comments-polls-reels]]'s Part 9 slice found for `reply`/`mention`).
 *
 * Real signal, honestly imperfect: compares the CURRENT request's User-Agent
 * against the account's other active sessions (`list_user_sessions`, the
 * same SECURITY DEFINER function the Active Sessions settings page already
 * reads). This is a coarse proxy, not device fingerprinting — Supabase's
 * `auth.sessions` has no IP/location column to check, and two different
 * physical devices with an identical browser/OS would look "the same." A
 * false positive (an extra alert) is a far safer failure mode for a
 * security notification than a false negative, so the imprecision is an
 * accepted trade-off, not a bug.
 *
 * Deliberately called from a CLIENT-triggered request (see
 * `app/api/auth/device-check/route.ts`) rather than from inside the
 * server-side OAuth/magic-link completion routes: those routes call
 * Supabase's auth API directly FROM our own server, so the user-agent THEY
 * observe would be our server's outgoing request, not the real visitor's
 * browser — meaningless for this comparison. A genuine same-origin fetch
 * from the browser is the only place the real device's User-Agent header
 * is actually available.
 *
 * Never throws — a failure here must NEVER be allowed to look like (or
 * cause) an auth problem.
 */
export async function checkNewDevice(userId: string, currentUserAgent: string | null): Promise<boolean> {
  if (!currentUserAgent) return false;
  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("list_user_sessions", { p_user_id: userId });
    if (error) return false;
    const rows = (data ?? []) as SessionRow[];
    if (!shouldAlertForNewDevice(rows, currentUserAgent)) return false;

    // DB-side dedupe on top of the pure check: within the recent-login
    // window a PWA relaunch gets a fresh sessionStorage (so the client-side
    // once-per-session gate doesn't help) — one alert per half-day is the
    // most this should ever produce, however many times the app reopens.
    const { data: recentAlert } = await db
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "security_new_device")
      .gte("created_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (recentAlert) return false;

    const { label } = parseDevice(currentUserAgent);
    const { error: insertError } = await db
      .from("notifications")
      .insert({ user_id: userId, actor_id: null, type: "security_new_device" });
    if (insertError) return false;

    // after(), not bare void — see lib/social/messages.ts's sendMessage() for why.
    after(() =>
      sendPushToUser(userId, {
        title: "New device signed in",
        body: `A sign-in from ${label} was detected. Wasn't you? Review your active sessions.`,
        url: "/account#sessions",
        tag: "security-new-device",
      }),
    );
    return true;
  } catch {
    return false;
  }
}
