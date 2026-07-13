"use client";

import { Check, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useAnchoredPanel } from "@/features/ui/use-anchored-panel";
import { haptic } from "@/lib/motion/haptics";
import type { PresenceStatus } from "@/lib/social/presence-status";
import { ensureMyPresenceStatusLoaded, getCachedMyPresenceStatus, setMyPresenceStatusLocal, subscribeMyPresenceStatus } from "@/lib/social/presence-status-client";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const OPTIONS: { value: PresenceStatus; label: string; hint: string; dot: string }[] = [
  { value: "available", label: "Available", hint: "Shown as online as usual", dot: "bg-emerald-400" },
  { value: "away", label: "Away", hint: "Auto-clears the moment you're back", dot: "bg-amber-400" },
  { value: "busy", label: "Busy", hint: "Still reachable, just heads-down", dot: "bg-rose-500" },
  { value: "dnd", label: "Do Not Disturb", hint: "Mutes attention, not messages", dot: "bg-violet-500" },
  { value: "invisible", label: "Invisible", hint: "Never appear online to anyone", dot: "bg-muted-foreground/50" },
];

/**
 * Manual presence status — lives at the top of the inbox (list header), NOT
 * inside an open thread (that's PresenceBadge's job, showing the OTHER
 * person's status). Selecting a status updates the shared client cache
 * (lib/social/presence-status-client.ts) immediately, which is what makes
 * `use-presence.ts` untrack/retrack from the shared online channel live —
 * this component itself only ever talks to the cache + the API route.
 */
export function PresenceStatusPicker() {
  const [status, setStatus] = useState<PresenceStatus>(getCachedMyPresenceStatus());
  const [saving, setSaving] = useState(false);
  const { triggerRef: buttonRef, open, setOpen, mounted, pos: panelPos, toggle: togglePanel } = useAnchoredPanel<HTMLButtonElement>(256);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      void ensureMyPresenceStatusLoaded(uid).then((s) => {
        if (!cancelled) setStatus(s);
      });
    });
    const unsubscribe = subscribeMyPresenceStatus((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const choose = async (next: PresenceStatus) => {
    if (next === status || saving) return;
    haptic("selection");
    setOpen(false);
    const prev = status;
    setStatus(next);
    setMyPresenceStatusLocal(next); // optimistic — also flips use-presence.ts's tracking immediately
    setSaving(true);
    try {
      const res = await fetch("/api/presence-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setStatus(prev);
        setMyPresenceStatusLocal(prev);
      }
    } catch {
      setStatus(prev);
      setMyPresenceStatusLocal(prev);
    } finally {
      setSaving(false);
    }
  };

  const active = OPTIONS.find((o) => o.value === status) ?? OPTIONS[0]!;

  // Same containing-block/clip problem — and same fix, via useAnchoredPanel —
  // as notification-settings-picker.tsx: this button sits in the same
  // inbox-header tools row, exposed to the identical `overflow-hidden`/
  // `backdrop-blur-xl` (desktop sidebar) / `overflow-y-auto` (mobile list)
  // ancestors.

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePanel}
        aria-label={`Status: ${active.label}`}
        title={`Status: ${active.label}`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        {status === "invisible" ? (
          <EyeOff className="h-[18px] w-[18px]" />
        ) : (
          <span className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-card", active.dot)} />
        )}
      </button>

      {open && mounted && panelPos
        ? createPortal(
            <>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <div
                className="glass-strong animate-scale-in fixed z-50 w-64 overflow-hidden rounded-2xl py-1.5"
                style={{ top: panelPos.top, right: panelPos.right }}
              >
                <p className="px-3.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your status</p>
                {OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => void choose(o.value)}
                    className="flex w-full items-center gap-3 px-3.5 py-2 text-left transition hover:bg-secondary"
                  >
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", o.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{o.hint}</span>
                    </span>
                    {o.value === status ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                  </button>
                ))}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
