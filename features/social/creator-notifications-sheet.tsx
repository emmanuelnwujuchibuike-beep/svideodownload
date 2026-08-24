"use client";

import { Bell, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import {
  CREATOR_NOTIFICATION_CHANNELS,
  CREATOR_NOTIFICATION_LABELS,
  DEFAULT_CREATOR_NOTIFICATION_PREFS,
  type CreatorNotificationChannel,
  type CreatorNotificationPrefs,
} from "@/lib/social/creator-notification-channels";
import { Portal } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/**
 * Per-creator notification switches (owner, 2026-08-23: "make users to be able
 * to turn on and off another users post notification, stories notification,
 * feed or share notification").
 *
 * ── Saves per switch, not behind a Save button ─────────────────────────────
 * Four independent booleans with no interdependencies: there is nothing to
 * validate across them and nothing to confirm, so a Save button would only add
 * a step and a way to lose a change by dismissing the sheet. Each toggle is
 * applied optimistically and rolled back if the request fails, which is the
 * same pattern Follow already uses.
 */
export function CreatorNotificationsSheet({
  userId,
  handle,
  open,
  onClose,
}: {
  userId: string;
  handle: string;
  open: boolean;
  onClose: () => void;
}) {
  const [prefs, setPrefs] = useState<CreatorNotificationPrefs | null>(null);
  const [saving, setSaving] = useState<CreatorNotificationChannel | null>(null);

  // Fetched on open rather than on mount: this sheet is rendered (closed)
  // alongside every post card that offers it, and a request per card would be
  // a feed-load's worth of round trips for a panel almost nobody opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPrefs(null);
    void fetch(`/api/creator-notifications/${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        // Defaults on failure — showing the real defaults is honest, where an
        // empty panel or a spinner that never resolves is not.
        setPrefs((json?.prefs as CreatorNotificationPrefs) ?? { ...DEFAULT_CREATOR_NOTIFICATION_PREFS });
      })
      .catch(() => {
        if (!cancelled) setPrefs({ ...DEFAULT_CREATOR_NOTIFICATION_PREFS });
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  if (!open) return null;

  const toggle = async (channel: CreatorNotificationChannel) => {
    if (!prefs || saving) return;
    haptic("selection");
    const next = !prefs[channel];
    const previous = prefs;
    setPrefs({ ...prefs, [channel]: next });
    setSaving(channel);
    try {
      const res = await fetch(`/api/creator-notifications/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [channel]: next }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      // Adopt the server's view rather than keeping the optimistic guess —
      // they agree today, and if they ever stop agreeing the switch should show
      // what was actually stored.
      if (json?.prefs) setPrefs(json.prefs as CreatorNotificationPrefs);
    } catch {
      setPrefs(previous);
      toast("Couldn't save that — try again.", "error");
    } finally {
      setSaving(null);
    }
  };

  /* Portalled — a `fixed inset-0` scrim is clipped to any transformed/blurred
     ancestor, and a profile page has several. See components/ui/portal.tsx. */
  return (
    <Portal>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Notification settings for @${handle}`}
      className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
    >
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md rounded-t-3xl border border-border/70 bg-card p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-elevated sm:rounded-3xl sm:pb-4">
        <div className="mb-3 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white">
            <Bell className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold leading-tight">Notifications</h2>
            <p className="truncate text-xs text-muted-foreground">from @{handle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!prefs ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <ul className="space-y-1">
            {CREATOR_NOTIFICATION_CHANNELS.map((channel) => {
              const meta = CREATOR_NOTIFICATION_LABELS[channel];
              const on = prefs[channel];
              return (
                <li key={channel}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => void toggle(channel)}
                    disabled={saving !== null}
                    className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-secondary/60 disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{meta.label}</span>
                      <span className="block text-xs text-muted-foreground">{meta.hint}</span>
                    </span>
                    {saving === channel ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <span
                        aria-hidden
                        className={cn(
                          "relative h-6 w-10 shrink-0 rounded-full transition",
                          on ? "bg-gradient-to-r from-blue-600 to-violet-600" : "bg-secondary ring-1 ring-inset ring-border",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                            on ? "left-[1.125rem]" : "left-0.5",
                          )}
                        />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
          These apply to @{handle} only. Your overall notification settings still
          decide what reaches you — see Settings › Notifications.
        </p>
      </div>
    </div>
    </Portal>
  );
}
