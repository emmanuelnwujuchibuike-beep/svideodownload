"use client";

import { Activity, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { timeAgo } from "@/features/notifications/meta";
import { parseDevice } from "@/lib/auth/device-label";

interface Event {
  id: string;
  type: string;
  userAgent: string | null;
  createdAt: string;
}

const LABELS: Record<string, string> = {
  login: "Signed in",
  device_added: "New device signed in",
  mfa_enrolled: "Two-factor authentication enabled",
  mfa_unenrolled: "Two-factor authentication turned off",
  session_revoked: "A device was signed out",
  password_changed: "Password changed",
  recovery_codes_generated: "Recovery codes generated",
  recovery_code_used: "A recovery code was used",
  recovery_code_failed: "A recovery code attempt failed",
  passkey_enrolled: "A passkey was added",
  passkey_removed: "A passkey was removed",
  stepup_verified: "Verified with a passkey",
  stepup_failed: "A passkey verification attempt failed",
  pin_set: "Security PIN changed",
  pin_lockout: "PIN entry locked after too many attempts",
  device_renamed: "A device was renamed",
  device_trust_changed: "A device's trusted status changed",
  device_forgotten: "A device was forgotten",
};

/** Read-only recent security activity — Account → Security. Sources the
 *  append-only security_audit_log table (migration 0053). */
export function SecurityActivity() {
  const [events, setEvents] = useState<Event[] | null>(null);

  useEffect(() => {
    fetch("/api/v1/app/security/audit-log?limit=12")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setEvents(json.data.events);
      })
      .catch(() => setEvents([]));
  }, []);

  return (
    <div className="p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Activity className="h-4 w-4 text-muted-foreground" /> Recent activity
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">A log of security-relevant events on your account.</p>

      <div className="mt-4 space-y-1">
        {events === null ? (
          <div className="flex h-10 items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm last:border-0">
              <span>{LABELS[e.type] ?? e.type}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {e.userAgent ? `${parseDevice(e.userAgent).label} · ` : ""}
                {timeAgo(e.createdAt)} ago
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
