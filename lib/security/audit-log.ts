import { createHmac } from "node:crypto";

import { clientId } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Append-only security audit trail (migration 0053). event_type is
 * free-form (not the notifications.type enum) — this is an internal record,
 * not a user-facing alert, so it can be written from far more call sites
 * without needing a new notification copy each time.
 *
 * IP is never stored raw — hashed with a server-only pepper so the row is
 * still useful for "was this the same network as last time" comparisons
 * without being a reversible IP log. If AUDIT_IP_HASH_SECRET isn't set,
 * ip_hash is simply omitted rather than falling back to a weak/guessable
 * hash.
 */
export type SecurityAuditEventType =
  | "login"
  | "device_added"
  | "mfa_enrolled"
  | "mfa_unenrolled"
  | "session_revoked"
  | "password_changed"
  | "recovery_codes_generated"
  | "recovery_code_used"
  | "recovery_code_failed"
  | "passkey_enrolled"
  | "passkey_removed"
  | "stepup_verified"
  | "stepup_failed"
  | "pin_set"
  | "pin_lockout"
  | "device_renamed"
  | "device_trust_changed"
  | "device_forgotten"
  | "moderation_action"
  | "appeal_submitted"
  | "appeal_resolved"
  | "account_deletion_requested"
  | "account_deletion_cancelled";

function hashIp(ip: string): string | null {
  const secret = process.env.AUDIT_IP_HASH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export async function writeAuditLog(params: {
  userId: string;
  eventType: SecurityAuditEventType;
  request?: Request;
  metadata?: Record<string, unknown>;
  /** Part 11c — an admin/moderator acting on `userId`'s content/account, not
   *  `userId` acting on their own. Defaults to `userId` (self-action), the
   *  11a behavior every existing call site still gets. */
  actorUserId?: string;
  /** Part 11c — the moderated post/comment/account this event is about. */
  targetType?: "post" | "comment" | "user";
  targetId?: string;
}): Promise<void> {
  const { userId, eventType, request, metadata, actorUserId, targetType, targetId } = params;
  try {
    const ip = request ? clientId(request.headers) : null;
    const db = createAdminClient();
    await db.from("security_audit_log").insert({
      user_id: userId,
      actor_user_id: actorUserId ?? userId,
      event_type: eventType,
      target_type: targetType ?? null,
      target_id: targetId ?? null,
      ip_hash: ip && ip !== "anonymous" ? hashIp(ip) : null,
      user_agent: request?.headers.get("user-agent") ?? null,
      metadata: metadata ?? {},
    });
  } catch {
    // Never let an audit-log write failure surface as (or cause) a real
    // security-flow error — the same fail-silent stance device-check.ts
    // takes for its own notification insert.
  }
}
