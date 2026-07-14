"use client";

import { AtSign, Bell, BellOff, Heart, Keyboard, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { useAnchoredPanel } from "@/features/ui/use-anchored-panel";
import { haptic } from "@/lib/motion/haptics";
import {
  ensureSoundPrefsLoaded,
  getCachedSoundPrefs,
  setSoundPrefsLocal,
  subscribeSoundPrefs,
  type SoundPrefs,
} from "@/lib/social/notification-sound-prefs-client";
import { cn } from "@/lib/utils";

const ROWS: { key: keyof Omit<SoundPrefs, "masterEnabled">; label: string; icon: typeof MessageCircle }[] = [
  { key: "messageEnabled", label: "New messages", icon: MessageCircle },
  { key: "mentionEnabled", label: "Mentions", icon: AtSign },
  { key: "reactionEnabled", label: "Reactions", icon: Heart },
  { key: "typingEnabled", label: "Typing", icon: Keyboard },
];

/**
 * "Message settings" — in-app interaction-sound toggles, at the top of the
 * inbox (owner instruction: NOT inside an open chat, unlike PresenceBadge/
 * typing indicators which are thread-local). Master switch + one per
 * interaction type; this ONLY governs the foreground Web Audio sound layer
 * (see lib/notifications/sound-fx.ts) — it has no effect on OS push
 * notifications, which always play the platform's own sound.
 */
export function NotificationSettingsPicker({ onCloseAll }: { onCloseAll?: () => void }) {
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
        onClick={togglePanel}
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
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setOpen(false);
                  onCloseAll?.();
                }}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                className="animate-scale-in fixed z-50 w-72 overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5 shadow-elevated"
                style={{ top: panelPos.top, right: panelPos.right }}
              >
                <div className="flex items-center gap-2.5 px-2.5 py-2">
                  <ModuleIconBadge icon={prefs.masterEnabled ? Bell : BellOff} className="h-9 w-9 rounded-xl" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">Interaction sounds</span>
                    <span className="block text-[11px] text-muted-foreground">While Frenz is open</span>
                  </span>
                  <Toggle checked={prefs.masterEnabled} onChange={(v) => void toggle({ masterEnabled: v })} />
                </div>
                <div
                  className={cn(
                    "mt-1 space-y-0.5 rounded-xl bg-secondary/40 p-1 transition-opacity",
                    !prefs.masterEnabled && "pointer-events-none opacity-40",
                  )}
                >
                  {ROWS.map((r) => (
                    <div key={r.key} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-secondary/60">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground">
                        <r.icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{r.label}</span>
                      <Toggle checked={prefs[r.key]} onChange={(v) => void toggle({ [r.key]: v })} />
                    </div>
                  ))}
                </div>
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
