import { after } from "next/server";

import { parseDevice } from "@/lib/auth/device-label";
import { sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SessionRow {
  id: string;
  created_at: string;
  user_agent: string | null;
}

/**
 * The actual "is this worth alerting about" decision, isolated from the
 * DB/push side effects so it has a real, direct unit test (see
 * `lib/auth/device-check.test.ts`) instead of only a throwaway
 * reimplementation. Exported pure.
 */
export function shouldAlertForNewDevice(rows: SessionRow[], currentUserAgent: string | null): boolean {
  if (!currentUserAgent) return false;
  // Only one (or zero) session on record — either the very first sign-in
  // ever, or a fresh account. Nothing to compare against yet; alerting here
  // would just be noise on account creation, not a real "new device" event.
  if (rows.length <= 1) return false;

  const sorted = [...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const [, ...older] = sorted; // exclude the just-created session
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
