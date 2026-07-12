"use client";

import { AlertTriangle, Check, Laptop, LogOut, Loader2, Monitor, Pencil, ShieldCheck, Smartphone, Tablet, X } from "lucide-react";
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
  isTrusted: boolean;
  deviceRowId: string | null;
}

const ICONS: Record<DeviceIcon, typeof Monitor> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  desktop: Monitor,
};

/** Active-devices list + per-device / bulk remote sign-out, rename, and
 *  "trusted device" toggle (Account → Security page — Part 11a). */
export function ActiveSessions() {
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // session id, or "others"
  const [renaming, setRenaming] = useState<string | null>(null); // deviceRowId
  const [renameValue, setRenameValue] = useState("");

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

  const toggleTrusted = async (s: SessionItem) => {
    if (!s.deviceRowId) return;
    setPending(s.id);
    try {
      const res = await fetch(`/api/v1/app/devices/${s.deviceRowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isTrusted: !s.isTrusted }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message);
      setSessions((prev) =>
        prev ? prev.map((row) => (row.id === s.id ? { ...row, isTrusted: json.data.device.isTrusted } : row)) : prev,
      );
    } catch {
      toast("Couldn't update that device. Try again.", "error");
    } finally {
      setPending(null);
    }
  };

  const startRename = (s: SessionItem) => {
    if (!s.deviceRowId) return;
    setRenaming(s.deviceRowId);
    setRenameValue(s.device.label);
  };

  const saveRename = async (s: SessionItem) => {
    if (!s.deviceRowId) return;
    const label = renameValue.trim();
    if (!label) {
      setRenaming(null);
      return;
    }
    setPending(s.id);
    try {
      const res = await fetch(`/api/v1/app/devices/${s.deviceRowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message);
      setSessions((prev) =>
        prev
          ? prev.map((row) => (row.id === s.id ? { ...row, device: { ...row.device, label: json.data.device.label } } : row))
          : prev,
      );
    } catch {
      toast("Couldn't rename that device. Try again.", "error");
    } finally {
      setPending(null);
      setRenaming(null);
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
        Devices currently signed in to your account. Mark a device trusted to recognize it later.
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
            const isRenaming = renaming === s.deviceRowId && !!s.deviceRowId;
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
                  {isRenaming ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(s);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        maxLength={60}
                        className="h-7 min-w-0 flex-1 rounded-lg bg-background px-2 text-sm outline-none ring-1 ring-inset ring-primary/50"
                      />
                      <button type="button" onClick={() => void saveRename(s)} aria-label="Save name" className="text-emerald-500">
                        <Check className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setRenaming(null)} aria-label="Cancel" className="text-muted-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{s.device.label}</span>
                      {s.isCurrent ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-500">
                          This device
                        </span>
                      ) : null}
                      {s.isTrusted ? (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          Trusted
                        </span>
                      ) : null}
                      {s.deviceRowId ? (
                        <button
                          type="button"
                          onClick={() => startRename(s)}
                          aria-label={`Rename ${s.device.label}`}
                          className="text-muted-foreground/60 transition hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      ) : null}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Active {timeAgo(s.lastActiveAt)} ago</p>
                </div>
                {s.deviceRowId ? (
                  <button
                    type="button"
                    onClick={() => void toggleTrusted(s)}
                    disabled={pending !== null}
                    className="text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                  >
                    {s.isTrusted ? "Untrust" : "Trust"}
                  </button>
                ) : null}
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
