"use client";

import { Check, Laptop, Loader2, LogOut, Monitor, Pencil, ShieldCheck, Smartphone, Tablet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { toast } from "@/features/ui/toast";
import { createClient } from "@/lib/supabase/client";
import {
  capabilitiesFor,
  compareByTrust,
  evaluateTrust,
  observationsFor,
  trustLevel,
} from "@/lib/devices/trust";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * Connected Devices Hub™ — Feature 18 · Part 23.
 *
 * ── What this is, and what it replaces ───────────────────────────────────────
 * `/account/security` already listed sessions with sign-out, rename and a trust
 * toggle. That list is not deleted and not duplicated: this page is the same
 * data given a hub of its own, with the one thing the list never had — a
 * MEANING for trust. `lib/devices/trust.ts` derives a level from evidence and
 * maps it to capabilities, so the badge on a card corresponds to what that
 * device is allowed to do.
 *
 * ── Everything shown is measured ─────────────────────────────────────────────
 * The brief asks for battery, network type, app version, storage, crash reports
 * and sync health per device. A web page cannot observe any of those about
 * ANOTHER device — there is no agent running there to report them, only a row
 * saying a session exists. Rendering an empty battery gauge or a made-up "sync
 * healthy" tick would be the fabrication this project has refused three times.
 *
 * So a card shows what the row genuinely holds: what the device is, when it was
 * first seen, when it was last used, its trust level and what that level
 * permits. The current device additionally shows the two things the browser
 * will actually answer for — and only where it answers.
 */

interface SessionItem {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  device: { label: string; icon: "phone" | "tablet" | "laptop" | "desktop" };
  isCurrent: boolean;
  isTrusted: boolean;
  deviceRowId: string | null;
  deviceFirstSeenAt: string | null;
  deviceLastSeenAt: string | null;
  deviceUserAgent: string | null;
  sessionUserAgent: string | null;
}

const ICONS = { phone: Smartphone, tablet: Tablet, laptop: Laptop, desktop: Monitor } as const;

function timeAgo(iso: string | null): string {
  if (!iso) return "Unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Unknown";
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return "Just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export function ConnectedDevices() {
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    fetch("/api/v1/app/sessions")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error?.message);
        setSessions(json.data.sessions as SessionItem[]);
      })
      .catch(() => {
        setSessions([]);
        setFailed(true);
      });
  }, []);

  /*
    Levels are computed here, on read, rather than stored — see the note in
    lib/devices/trust.ts. Sorted so the device in your hand leads and anything
    worth a second look sinks to the bottom, which is the order a person scans.
  */
  const rows = useMemo(() => {
    const list = (sessions ?? []).map((s) => {
      const signals = {
        isCurrent: s.isCurrent,
        isTrusted: s.isTrusted,
        firstSeenAt: s.deviceFirstSeenAt ?? s.createdAt,
        lastSeenAt: s.deviceLastSeenAt ?? s.lastActiveAt,
        originalUserAgent: s.deviceUserAgent,
        currentUserAgent: s.sessionUserAgent,
      };
      const level = evaluateTrust(signals);
      return { session: s, level, notes: observationsFor(signals) };
    });
    return list.sort((a, b) => compareByTrust(a.level, b.level));
  }, [sessions]);

  const others = rows.filter((r) => !r.session.isCurrent).length;

  const revoke = async (s: SessionItem) => {
    setPending(s.id);
    try {
      const res = await fetch(`/api/v1/app/sessions/${s.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message);
      if (s.isCurrent) {
        /* The server session is already gone; clearing the local cookie and
           leaving beats showing a "signed in" screen that is no longer true. */
        await createClient().auth.signOut();
        window.location.href = "/login";
        return;
      }
      setSessions((prev) => prev?.filter((row) => row.id !== s.id) ?? prev);
      toast("Device signed out.", "success");
    } catch {
      toast("Couldn't sign that device out. Try again.", "error");
    } finally {
      setPending(null);
    }
  };

  const revokeOthers = async () => {
    setPending("others");
    try {
      const res = await fetch("/api/v1/app/sessions", { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message);
      setSessions((prev) => prev?.filter((row) => row.isCurrent) ?? prev);
      toast("Signed out of every other device.", "success");
    } catch {
      toast("Couldn't sign out other devices. Try again.", "error");
    } finally {
      setPending(null);
    }
  };

  const patchDevice = async (s: SessionItem, body: Record<string, unknown>) => {
    if (!s.deviceRowId) return;
    setPending(s.id);
    try {
      const res = await fetch(`/api/v1/app/devices/${s.deviceRowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message);
      setSessions((prev) =>
        prev?.map((row) =>
          row.id === s.id
            ? {
                ...row,
                isTrusted: json.data.device.isTrusted ?? row.isTrusted,
                device: { ...row.device, label: json.data.device.label ?? row.device.label },
              }
            : row,
        ) ?? prev,
      );
    } catch {
      toast("Couldn't update that device. Try again.", "error");
    } finally {
      setPending(null);
      setRenaming(null);
    }
  };

  if (sessions === null) {
    return (
      <div className="flex items-center gap-2 px-1 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your devices…
      </div>
    );
  }

  if (failed) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
        Couldn&apos;t load your devices just now. Refresh to try again.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-sm leading-relaxed text-muted-foreground">
        Every device with an active session. Signing one out ends it immediately, everywhere.
      </p>

      <div className="space-y-2.5">
        {rows.map(({ session: s, level, notes }) => {
          const Icon = ICONS[s.device.icon] ?? Monitor;
          const spec = trustLevel(level);
          const caps = capabilitiesFor(level);
          const busy = pending === s.id;
          const editing = renaming === s.deviceRowId && !!s.deviceRowId;

          return (
            <div
              key={s.id}
              className={cn(
                "rounded-2xl border bg-card p-4 transition",
                s.isCurrent ? "border-primary/40" : "border-border/70",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-foreground">
                  <Icon className="h-5 w-5" />
                </span>

                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && renameValue.trim()) void patchDevice(s, { label: renameValue.trim() });
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        aria-label="Device name"
                        className="h-9 min-w-0 flex-1 rounded-xl bg-secondary px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => renameValue.trim() && void patchDevice(s, { label: renameValue.trim() })}
                        aria-label="Save name"
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming(null)}
                        aria-label="Cancel"
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-sm font-bold">{s.device.label}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
                          spec.tone === "positive" && "bg-primary/15 text-primary",
                          spec.tone === "neutral" && "bg-secondary text-muted-foreground",
                          spec.tone === "caution" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {spec.label}
                      </span>
                    </div>
                  )}

                  <p className="mt-1 text-xs text-muted-foreground">
                    {spec.blurb}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Last used {timeAgo(s.deviceLastSeenAt ?? s.lastActiveAt).toLowerCase()}
                    {s.deviceFirstSeenAt ? ` · first seen ${timeAgo(s.deviceFirstSeenAt).toLowerCase()}` : ""}
                  </p>

                  {/* Observations, not accusations — see observationsFor. */}
                  {notes.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {notes.map((n) => (
                        <li
                          key={n.id}
                          className={cn(
                            "text-xs leading-snug",
                            n.tone === "caution" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
                          )}
                        >
                          {n.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/*
                    What the level actually GRANTS, stated plainly. A trust badge
                    that does not say what it changes is a badge; this is the
                    line that makes it a setting.
                  */}
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground/80">
                    {caps.changeSecuritySettings
                      ? "Can change security settings without signing in again."
                      : "Asks you to confirm before changing security settings."}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {s.deviceRowId ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            haptic("selection");
                            void patchDevice(s, { isTrusted: !s.isTrusted });
                          }}
                          aria-pressed={s.isTrusted}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition disabled:opacity-50",
                            s.isTrusted ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {s.isTrusted ? "Trusted" : "Trust this device"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRenaming(s.deviceRowId);
                            setRenameValue(s.device.label);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Rename
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void revoke(s)}
                      /* rose-500, not a `destructive` token — this palette
                         does not define one, so those classes emit no CSS at
                         all and the button would render as body text. The
                         design-token test catches it; it caught this. */
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                      {s.isCurrent ? "Sign out here" : "Sign out"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {others > 0 ? (
        <button
          type="button"
          disabled={pending === "others"}
          onClick={() => void revokeOthers()}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-semibold transition hover:bg-secondary disabled:opacity-50"
        >
          {pending === "others" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Sign out of {others} other device{others === 1 ? "" : "s"}
        </button>
      ) : null}

      {/*
        Said plainly rather than implied — the same rule the Accessibility
        Center follows. Somebody reading a security screen is entitled to know
        the limits of what it can tell them.
      */}
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Frenz can only see what each device reports when it signs in: what kind of device it is, and when it was last
        used. It cannot see a device&apos;s location, battery or files, so nothing here is guessed from those.
      </p>
    </div>
  );
}
