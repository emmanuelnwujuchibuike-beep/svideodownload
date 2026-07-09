"use client";

import { AlertTriangle, Laptop, LogOut, Loader2, Monitor, ShieldCheck, Smartphone, Tablet } from "lucide-react";
import { useEffect, useState } from "react";

import { timeAgo } from "@/features/notifications/meta";
import { toast } from "@/features/ui/toast";
import type { DeviceIcon } from "@/lib/auth/device-label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface SessionItem {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  device: { label: string; icon: DeviceIcon };
  isCurrent: boolean;
}

const ICONS: Record<DeviceIcon, typeof Monitor> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  desktop: Monitor,
};

/** Active-devices list + per-device / bulk remote sign-out (Account page). */
export function ActiveSessions() {
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // session id, or "others"

  const load = () => {
    setLoadError(false);
    fetch("/api/v1/app/sessions")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error?.message);
        setSessions(json.data.sessions as SessionItem[]);
      })
      .catch(() => {
        setSessions([]);
        setLoadError(true);
      });
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (id: string, isCurrent: boolean) => {
    setPending(id);
    try {
      const res = await fetch(`/api/v1/app/sessions/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message);
      if (isCurrent) {
        // The server-side session is already gone — clear the local cookie too
        // and leave immediately rather than showing a now-stale "signed in" UI.
        await createClient().auth.signOut();
        window.location.href = "/login";
        return;
      }
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
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
      setSessions((prev) => (prev ? prev.filter((s) => s.isCurrent) : prev));
      toast("Signed out of every other device.", "success");
    } catch {
      toast("Couldn't sign out other devices. Try again.", "error");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="border-b border-border/60 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Active sessions
        </h2>
        {sessions && sessions.length > 1 ? (
          <button
            type="button"
            onClick={revokeOthers}
            disabled={pending !== null}
            className="text-xs font-medium text-muted-foreground transition hover:text-red-400 disabled:opacity-50"
          >
            {pending === "others" ? "Signing out…" : "Sign out other devices"}
          </button>
        ) : null}
      </div>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Devices currently signed in to your account.
      </p>

      <div className="mt-4 space-y-2">
        {sessions === null ? (
          <div className="flex h-14 items-center px-1 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : loadError ? (
          <p className="flex items-center gap-2 px-1 text-sm text-amber-500">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Couldn&apos;t load your sessions. Refresh to try again.
          </p>
        ) : sessions.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          sessions.map((s) => {
            const Icon = ICONS[s.device.icon];
            const isPending = pending === s.id;
            return (
              <div
                key={s.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border p-3.5",
                  s.isCurrent ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-border/60 bg-secondary/20",
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {s.device.label}
                    {s.isCurrent ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-500">
                        This device
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">Active {timeAgo(s.lastActiveAt)} ago</p>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(s.id, s.isCurrent)}
                  disabled={pending !== null}
                  aria-label={`Sign out ${s.device.label}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                  Sign out
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
