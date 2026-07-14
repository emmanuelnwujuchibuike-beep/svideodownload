"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useAnchoredPanel } from "@/features/ui/use-anchored-panel";
import { haptic } from "@/lib/motion/haptics";
import {
  ensureSoundPrefsLoaded,
  getCachedSoundPrefs,
  setSoundPrefsLocal,
  subscribeSoundPrefs,
  type SoundPrefs,
} from "@/lib/social/notification-sound-prefs-client";
import { FORCE_LIGHT_VARS } from "@/lib/theme/force-light-vars";
import { cn } from "@/lib/utils";

const ROWS: { key: keyof Omit<SoundPrefs, "masterEnabled">; label: string }[] = [
  { key: "messageEnabled", label: "New messages" },
  { key: "mentionEnabled", label: "Mentions" },
  { key: "reactionEnabled", label: "Reactions" },
  { key: "typingEnabled", label: "Typing" },
];

/**
 * "Message settings" — in-app interaction-sound toggles, at the top of the
 * inbox (owner instruction: NOT inside an open chat, unlike PresenceBadge/
 * typing indicators which are thread-local). Master switch + one per
 * interaction type; this ONLY governs the foreground Web Audio sound layer
 * (see lib/notifications/sound-fx.ts) — it has no effect on OS push
 * notifications, which always play the platform's own sound.
 */
export function NotificationSettingsPicker({ onNavigate }: { onNavigate?: () => void }) {
  const [prefs, setPrefs] = useState<SoundPrefs>(getCachedSoundPrefs());
  const [saving, setSaving] = useState(false);
  const { triggerRef: buttonRef, open, setOpen, mounted, pos: panelPos, toggle: togglePanel } = useAnchoredPanel<HTMLButtonElement>(256);

  useEffect(() => {
    let cancelled = false;
    void ensureSoundPrefsLoaded().then((p) => {
      if (!cancelled) setPrefs(p);
    });
    const unsubscribe = subscribeSoundPrefs((p) => {
      if (!cancelled) setPrefs(p);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const toggle = async (patch: Partial<SoundPrefs>) => {
    if (saving) return;
    haptic("selection");
    const prev = prefs;
    setSoundPrefsLocal(patch);
    setSaving(true);
    try {
      const res = await fetch("/api/notification-sound-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) setSoundPrefsLocal(prev);
    } catch {
      setSoundPrefsLocal(prev);
    } finally {
      setSaving(false);
    }
  };

  // This button lives in the inbox header's expanding tools row, which on
  // desktop sits inside an `overflow-hidden` + `backdrop-blur-xl` sidebar
  // (app/(app)/messages/layout.tsx's `<aside>`) and on mobile inside an
  // `overflow-y-auto` list container — the ancestor combination that already
  // broke the message-action menu (see conversation-room.tsx's
  // `toggleMessageMenu` comment) — hence useAnchoredPanel's portal.

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        role="menuitem"
        onClick={() => {
          togglePanel();
          onNavigate?.();
        }}
        aria-label="Message sound settings"
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition hover:bg-secondary"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/80 text-muted-foreground">
          {prefs.masterEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </span>
        Message sounds
      </button>

      {open && mounted && panelPos
        ? createPortal(
            <>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <div
                // bg-card + FORCE_LIGHT_VARS — see presence-status-picker.tsx's
                // own comment; same header-anchored panel, same fix.
                className="animate-scale-in fixed z-50 w-64 overflow-hidden rounded-2xl border border-border/70 bg-card py-1.5 shadow-elevated"
                style={{ top: panelPos.top, right: panelPos.right, ...FORCE_LIGHT_VARS }}
              >
                <div className="flex items-center justify-between px-3.5 py-2">
                  <span className="text-sm font-semibold">Interaction sounds</span>
                  <Toggle checked={prefs.masterEnabled} onChange={(v) => void toggle({ masterEnabled: v })} />
                </div>
                <div className={cn("border-t border-border/60 py-1", !prefs.masterEnabled && "pointer-events-none opacity-40")}>
                  {ROWS.map((r) => (
                    <div key={r.key} className="flex items-center justify-between px-3.5 py-1.5">
                      <span className="text-sm text-muted-foreground">{r.label}</span>
                      <Toggle checked={prefs[r.key]} onChange={(v) => void toggle({ [r.key]: v })} />
                    </div>
                  ))}
                </div>
                <p className="border-t border-border/60 px-3.5 pt-2 text-[11px] text-muted-foreground">Only affects sounds while Frenz is open.</p>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-brand" : "bg-secondary")}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
