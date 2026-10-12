import "server-only";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { createAdminClient } from "@/lib/supabase/admin";

import { assessFailures, assessSignIn, FAILED_CHECKS_WINDOW_MS, NEW_COUNTRY_WINDOW_MS, PIN_LOCKOUT, type Suspicion } from "./suspicious";

/**
 * Runs the Suspicious Activity Engine after an audit event (called by writeAuditLog, after the
 * response). One indexed read of the member's own log; at most one alert per reason per 12 h,
 * sent as a CRITICAL security notification (it reaches the member through Do Not Disturb —
 * the existing rule for security). Best effort: never affects the action that triggered it.
 */
const FAILURES = new Set(["recovery_code_failed", "stepup_failed"]);
const DEDUPE_MS = 12 * 3_600_000;

type Row = { event_type: string; created_at: string; metadata: { country?: string | null } | null };

export async function runSuspicionChecks(userId: string, eventType: string, country: string | null): Promise<void> {
  if (eventType !== "login" && eventType !== "pin_lockout" && !FAILURES.has(eventType)) return;
  try {
    const db = createAdminClient();
    const now = Date.now();
    let found: Suspicion | null = null;
    if (eventType === "pin_lockout") found = PIN_LOCKOUT;
    else {
      const since = new Date(now - (eventType === "login" ? NEW_COUNTRY_WINDOW_MS : FAILED_CHECKS_WINDOW_MS)).toISOString();
      const types = eventType === "login" ? ["login"] : [...FAILURES];
      const { data } = await db.from("security_audit_log").select("event_type, created_at, metadata").eq("user_id", userId).in("event_type", types).gte("created_at", since).order("created_at", { ascending: false }).limit(200);
      const rows = (data ?? []) as Row[];
      if (eventType === "login") {
        // the newest row is the sign-in that was just written
        const [, ...earlier] = rows;
        found = assessSignIn({ country, at: now }, earlier.map((r) => ({ country: r.metadata?.country ?? null, at: Date.parse(r.created_at) })));
      } else found = assessFailures(rows.map((r) => Date.parse(r.created_at)), now);
    }
    if (!found) return;
    // one alert per reason per 12 hours
    const { data: recent } = await db.from("notifications").select("id").eq("user_id", userId).eq("type", "security_suspicious").eq("data->>title", found.title).gte("created_at", new Date(now - DEDUPE_MS).toISOString()).limit(1);
    if (recent?.length) return;
    await sendSmartPush(
      userId,
      { title: found.title, body: found.body, url: "/account/security#activity", tag: `security-${found.reason}` },
      "critical",
      "security",
      { type: "security_suspicious" },
    );
  } catch {
    /* never affects the security action itself */
  }
}
