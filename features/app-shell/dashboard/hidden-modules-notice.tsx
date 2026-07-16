"use client";

import { EyeOff, Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { HOME_MODULE_LABELS, type HomeModuleKey } from "@/lib/social/home-preferences";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";

/**
 * "Option 2" (owner's pick, 2026-07-16) for the Continue Watching mystery.
 *
 * The report was "Continue Watching only shows in the admin account". It turned
 * out not to be a bug at all: querying `user_home_preferences` showed three
 * accounts with `hidden_modules: ["continue_watching"]` and the owner's own
 * with `[]` — they had each hidden it. Three of four rows hiding EXACTLY that
 * one module doesn't look like curation; it looks like an easy-to-hit control
 * (there used to be an inline hide switch on the module itself, since removed —
 * `/api/home-preferences` still carries `hideModule`/`showModule` "for the
 * inline Home-page switches").
 *
 * Offered three ways to fix it, the owner chose: leave their saved preference
 * alone, make hidden modules DISCOVERABLE instead. That's the real defect —
 * hiding was one accidental tap away with no visible path back. The only route
 * to restore was /account → "Home & feed" → the Home Modules Editor, buried far
 * down a long settings page, which nobody would think to look for. The owner
 * proved the point themselves minutes later: "i dont even see the toggle."
 *
 * So: if (and only if) something is hidden, Home says so, right where it went
 * missing, and restores it in one tap. Nothing is shown to a viewer who hasn't
 * hidden anything — this must never become clutter for the 99% case.
 */
export function HiddenModulesNotice({ hidden }: { hidden: HomeModuleKey[] }) {
  const [restored, setRestored] = useState<HomeModuleKey[]>([]);
  const [busy, setBusy] = useState<HomeModuleKey | null>(null);

  const remaining = hidden.filter((k) => !restored.includes(k));
  if (remaining.length === 0) return null;

  const restore = async (key: HomeModuleKey) => {
    haptic("selection");
    playSound("tap");
    setBusy(key);
    try {
      // `showModule` (not a client-computed `hiddenModules` array) — the API
      // applies it against whatever is CURRENTLY saved, so this can't clobber a
      // change made in another tab or in the Home Modules Editor at the same
      // moment. That's the whole reason the surgical action exists.
      const res = await fetch("/api/home-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showModule: key }),
      });
      if (!res.ok) throw new Error();
      // Optimistically drop the chip. The module itself is server-rendered, so
      // it appears on the next Home load — deliberately NOT a router.refresh()
      // here, which would blow away the whole client Router Cache (the cause of
      // "Home reloads on every entry", fixed separately).
      setRestored((prev) => [...prev, key]);
    } catch {
      /* leave the chip in place so it can simply be tapped again */
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label="Hidden sections"
      className="rounded-2xl border border-dashed border-border/70 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5" />
          {remaining.length === 1 ? "A section is hidden" : `${remaining.length} sections are hidden`}
        </span>
        {remaining.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => void restore(key)}
            disabled={busy === key}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-2 pr-2.5 text-xs font-semibold text-primary transition hover:bg-primary/15 disabled:opacity-50"
          >
            {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {HOME_MODULE_LABELS[key]}
          </button>
        ))}
      </div>
    </section>
  );
}
