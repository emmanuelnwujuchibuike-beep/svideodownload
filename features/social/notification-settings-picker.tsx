"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import {
  ensureSoundPrefsLoaded,
  getCachedSoundPrefs,
  setSoundPrefsLocal,
  subscribeSoundPrefs,
  type SoundPrefs,
} from "@/lib/social/notification-sound-prefs-client";
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
export function NotificationSettingsPicker() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<SoundPrefs>(getCachedSoundPrefs());
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Message sound settings"
        title="Message sound settings"
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        {prefs.masterEnabled ? <Bell className="h-[18px] w-[18px]" /> : <BellOff className="h-[18px] w-[18px]" />}
      </button>

      {open ? (
        <>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="glass-strong animate-scale-in absolute right-0 top-10 z-50 w-64 overflow-hidden rounded-2xl py-1.5">
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
        </>
      ) : null}
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
