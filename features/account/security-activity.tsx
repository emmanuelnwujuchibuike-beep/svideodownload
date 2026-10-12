"use client";

import { Activity, CheckCircle2, Loader2, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { timeAgo } from "@/features/notifications/meta";
import { parseDevice } from "@/lib/auth/device-label";

interface Event {
  id: string;
  type: string;
  userAgent: string | null;
  country: string | null;
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
  moderation_action: "A moderation action was taken on your content",
  appeal_submitted: "You submitted an appeal",
  appeal_resolved: "Your appeal was resolved",
  account_deletion_requested: "Account deletion requested",
  account_deletion_cancelled: "Account deletion request cancelled",
};
/** The events that are a warning sign rather than routine. */
const WARN = new Set(["recovery_code_failed", "stepup_failed", "pin_lockout", "mfa_unenrolled", "account_deletion_requested"]);

function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * SECURITY TIMELINE — Account → Security (Feature 20 Part 7, upgrading the "Recent activity"
 * list rather than adding a second one). The append-only security_audit_log (0053): what
 * happened, on which device, from which country (the edge's own header — no IP shown or
 * stored), and when. Searchable over what is loaded, paged through the whole history, the
 * warning signs marked. Below it, "Verify an alert": every Frenz security notification carries
 * a reference code, and only a genuine one is found in this account.
 */
export function SecurityActivity() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState("");

  const load = async (after: string | null) => {
    const url = `/api/v1/app/security/audit-log?limit=20${after ? `&cursor=${encodeURIComponent(after)}` : ""}`;
    const json = (await fetch(url).then((r) => r.json()).catch(() => null)) as { ok?: boolean; data?: { events: Event[] }; meta?: { nextCursor?: string | null } } | null;
    if (!json?.ok || !json.data) return setEvents((e) => e ?? []);
    setEvents((e) => [...(after ? (e ?? []) : []), ...json.data!.events]);
    setCursor(json.meta?.nextCursor ?? null);
  };
  useEffect(() => {
    void load(null);
  }, []);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!events || !term) return events;
    return events.filter((e) => [LABELS[e.type] ?? e.type, e.userAgent ? parseDevice(e.userAgent).label : "", countryName(e.country) ?? ""].join(" ").toLowerCase().includes(term));
  }, [events, q]);

  return (
    <div id="activity" className="scroll-mt-24 p-6 sm:p-8">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Activity className="h-4 w-4 text-muted-foreground" /> Security timeline
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">Every sign-in and security change on your account, with the device and approximate country.</p>

      <label className="relative mt-4 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search activity"
          aria-label="Search security activity"
          className="min-h-11 w-full rounded-xl border border-border/60 bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      </label>

      <div className="mt-3 space-y-1">
        {shown === null ? (
          <div className="flex h-10 items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{q ? "Nothing matches that." : "No activity recorded yet."}</p>
        ) : (
          shown.map((e) => {
            const where = countryName(e.country);
            return (
              <div key={e.id} className="flex items-start justify-between gap-3 border-b border-border/40 py-2.5 text-sm last:border-0">
                <span className="flex min-w-0 items-start gap-2">
                  {WARN.has(e.type) ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="Warning" /> : null}
                  <span>{LABELS[e.type] ?? e.type}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  {e.userAgent ? parseDevice(e.userAgent).label : ""}
                  {where ? `${e.userAgent ? " · " : ""}${where}` : ""}
                  <span className="block">{timeAgo(e.createdAt)} ago</span>
                </span>
              </div>
            );
          })
        )}
      </div>
      {cursor && !q ? (
        <button
          type="button"
          disabled={more}
          onClick={async () => {
            setMore(true);
            await load(cursor);
            setMore(false);
          }}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-secondary px-4 text-sm font-semibold"
        >
          {more ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Show more
        </button>
      ) : null}

      <VerifyAlert />
    </div>
  );
}

function VerifyAlert() {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ genuine: boolean; title?: string; at?: string; error?: string } | null>(null);
  const check = async () => {
    if (!ref.trim() || busy) return;
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/security/verify-alert?ref=${encodeURIComponent(ref.trim())}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { genuine?: boolean; title?: string; at?: string; error?: string } | null;
    setBusy(false);
    setResult(res?.ok && j ? { genuine: !!j.genuine, title: j.title, at: j.at } : { genuine: false, error: j?.error ?? "Couldn't check right now." });
  };
  return (
    <div className="mt-6 rounded-2xl border border-border/60 bg-secondary/15 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Verify an alert
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Every Frenz security alert ends with a reference like FZ-7K2M9QXA. Paste it here to check it really came from Frenz. Frenz will never ask for your password or a code in a message.</p>
      <div className="mt-3 flex gap-2">
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value.toUpperCase().slice(0, 16))}
          onKeyDown={(e) => e.key === "Enter" && void check()}
          placeholder="FZ-XXXXXXXX"
          aria-label="Alert reference"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-border/60 bg-background px-3 font-mono text-sm tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <button type="button" onClick={() => void check()} disabled={busy || !ref.trim()} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Check
        </button>
      </div>
      {result ? (
        result.genuine ? (
          <p role="status" className="mt-3 flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Genuine — Frenz sent you &ldquo;{result.title}&rdquo; {result.at ? `${timeAgo(result.at)} ago` : ""}.
          </p>
        ) : (
          <p role="status" className="mt-3 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {result.error ?? "Not found. Frenz did not send this alert to your account — don't tap its links or share any codes."}
          </p>
        )
      ) : null}
    </div>
  );
}
