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
  // Copy corrected 2026-07-16 alongside the delivery change: DND now holds back
  // every push including DMs (owner: "do not disturb doesnt send push
  // notification"), so "Mutes attention, not messages" had become a false
  // promise about what this switch does.
  { value: "dnd", label: "Do Not Disturb", hint: "No push notifications at all", dot: "bg-violet-500" },
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
export function PresenceStatusPicker({ onCloseAll }: { onCloseAll?: () => void }) {
  const [status, setStatus] = useState<PresenceStatus>(getCachedMyPresenceStatus());
  const [saving, setSaving] = useState(false);
  // Owner, 2026-07-16: "make users be able to hide their last seen when they
  // switch between away, do not disturb and all." The setting itself already
  // existed (`privacy_settings.last_seen_visibility`, honored by
  // presence-status.ts) — it was just buried in Settings → Privacy, nowhere near
  // the status switcher where the thought actually occurs. This surfaces the
  // same field; it does NOT add a second, competing one.
  //
  // `null` = not loaded yet, which renders as neither on nor off rather than
  // guessing "off" and flipping under the user a moment later.
  const [lastSeenHidden, setLastSeenHidden] = useState<boolean | null>(null);
  const [savingLastSeen, setSavingLastSeen] = useState(false);
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

  // Only fetched when the panel is actually opened — the inbox header shouldn't
  // pay a request for a control nobody has looked at yet.
  useEffect(() => {
    if (!open || lastSeenHidden !== null) return;
    let cancelled = false;
    void fetch("/api/privacy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { last_seen_visibility?: string } | null) => {
        if (!cancelled && d) setLastSeenHidden(d.last_seen_visibility === "nobody");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, lastSeenHidden]);

  const toggleLastSeen = async () => {
    if (savingLastSeen || lastSeenHidden === null) return;
    haptic("selection");
    const next = !lastSeenHidden;
    setLastSeenHidden(next); // optimistic
    setSavingLastSeen(true);
    try {
      const res = await fetch("/api/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // "nobody" hides it from everyone; "everyone" is the column's own
        // default. Deliberately not "friends" — this is a two-state switch, and
        // silently landing someone on a third value they didn't pick would be
        // worse than sending them to Settings → Privacy for the finer control.
        body: JSON.stringify({ last_seen_visibility: next ? "nobody" : "everyone" }),
      });
      if (!res.ok) setLastSeenHidden(!next);
    } catch {
      setLastSeenHidden(!next);
    } finally {
      setSavingLastSeen(false);
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
        role="menuitem"
        onClick={togglePanel}
        aria-label={`Status: ${active.label}`}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition hover:bg-secondary"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/80 text-muted-foreground">
          {status === "invisible" ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <span className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-card", active.dot)} />
          )}
        </span>
        Status: {active.label}
      </button>

      {open && mounted && panelPos
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close"
                // onPointerDown, not onClick — same touch fix as the other
                // menus/sheets (owner, 2026-07-16: tapping the background should
                // close an open menu in chat and the inbox). `click` waits for
                // the browser's tap-vs-scroll resolution and gets swallowed over
                // a scrollable list.
                onPointerDown={() => {
                  setOpen(false);
                  onCloseAll?.();
                }}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                className="animate-scale-in fixed z-50 w-64 overflow-hidden rounded-2xl border border-border/70 bg-card py-1.5 shadow-elevated"
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

                {/* Privacy sits with the status it belongs to, not two screens
                    away in Settings. Same underlying field as the Privacy page's
                    "Last seen" control — one setting, two entry points. */}
                <div className="mt-1 border-t border-border/60 pt-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={lastSeenHidden ?? false}
                    disabled={lastSeenHidden === null || savingLastSeen}
                    onClick={() => void toggleLastSeen()}
                    className="flex w-full items-center gap-3 px-3.5 py-2 text-left transition hover:bg-secondary disabled:opacity-60"
                  >
                    <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">Hide my last seen</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {lastSeenHidden === null
                          ? "Checking…"
                          : lastSeenHidden
                            ? "Nobody sees when you were online"
                            : "Everyone sees when you were online"}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                        lastSeenHidden ? "bg-primary" : "bg-border",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          lastSeenHidden ? "translate-x-[1.15rem]" : "translate-x-0.5",
                        )}
                      />
                    </span>
                  </button>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
