"use client";

import { Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { A11Y_STORAGE_KEY, cssVariables, dataAttributes } from "@/lib/a11y/apply";
import {
  A11Y_PRESETS,
  applyPreset,
  COLOR_FILTERS,
  DEFAULT_A11Y,
  isCustomised,
  normalise,
  TEXT_SCALES,
  type A11yPreferences,
} from "@/lib/a11y/preferences";
import { hapticsEnabled, setHapticsEnabled } from "@/lib/motion/haptic-prefs";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * Accessibility Center™ (Feature 18 · Part 22).
 *
 * ── Every change is instant and local ───────────────────────────────────────
 * The brief asks for "instant accessibility changes, no restart required" and
 * offline support. Writing a preference stamps `<html>` in the same tick and
 * persists to `localStorage` — no request, no save button, no spinner.
 *
 * There is deliberately no "Save": a settings screen where you must confirm a
 * change you can already see is a screen that makes you doubt what you are
 * looking at. Everything here is visible the instant it is toggled, and
 * reversible from the same control.
 *
 * ── Device-local, on purpose ────────────────────────────────────────────────
 * Accessibility is the ONE preference category where per-device is correct
 * rather than a compromise. Someone's phone may need 130% text while their
 * desktop does not, and a screen-reader setup on a personal laptop should not
 * be pushed onto a shared family tablet. Cloud sync is a later, opt-in thing.
 */
export function AccessibilityCenter() {
  /*
    `null` until read. The server cannot know these — they live in
    localStorage — so rendering defaults first and correcting after mount would
    show someone the exact settings they turned off. Nothing renders until the
    real values are in hand.
  */
  const [prefs, setPrefs] = useState<A11yPreferences | null>(null);
  /*
    Haptics live in their own device-local store rather than in `prefs`
    (lib/motion/haptic-prefs.ts). Read in an effect, not during render: the
    server has no idea what this device chose, so rendering the default first
    and correcting after hydration would flash the setting someone turned OFF
    back on — the same reason `prefs` renders nothing until it is read.
  */
  const [haptics, setHaptics] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(A11Y_STORAGE_KEY);
      setPrefs(normalise(raw ? JSON.parse(raw) : {}));
    } catch {
      setPrefs({ ...DEFAULT_A11Y });
    }
    setHaptics(hapticsEnabled());
  }, []);

  /** Write once: to the DOM (instant), then to storage (persistent). */
  const commit = (next: A11yPreferences) => {
    setPrefs(next);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(cssVariables(next))) root.style.setProperty(k, v);
    /*
      Attributes are REPLACED wholesale, including removal. `dataAttributes`
      omits `data-a11y-motion` for "system", and omitting it from the object is
      not the same as clearing it from the element — without this the attribute
      would survive being switched back and the OS would stay overridden.
    */
    const managed = ["data-a11y-contrast", "data-a11y-transparency", "data-a11y-bold", "data-a11y-motion"];
    const attrs = dataAttributes(next);
    for (const name of managed) {
      const value = attrs[name];
      if (value === undefined) root.removeAttribute(name);
      else root.setAttribute(name, value);
    }
    try {
      localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked — the change still applies for this session */
    }
  };

  const set = <K extends keyof A11yPreferences>(key: K, value: A11yPreferences[K]) => {
    if (!prefs) return;
    haptic("selection");
    commit({ ...prefs, [key]: value });
  };

  if (!prefs) return null;

  return (
    <div className="space-y-5">
      {/* ── Presets ───────────────────────────────────────────────────────── */}
      <section>
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Presets</h2>
        <p className="mb-2 px-1 text-xs text-muted-foreground">
          A starting point, not a mode — everything below stays editable afterwards.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {A11Y_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                haptic("selection");
                commit(applyPreset(prefs, preset.id));
              }}
              className="rounded-2xl border border-border/70 bg-card p-3 text-left transition hover:border-primary/40 active:scale-[0.99]"
            >
              <span className="flex items-center gap-2 text-sm font-bold">
                {preset.id === "default" ? <RotateCcw className="h-3.5 w-3.5" /> : null}
                {preset.label}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{preset.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Text ──────────────────────────────────────────────────────────── */}
      <Group label="Text" hint="Changes apply everywhere in Frenz, instantly.">
        <Row label="Text size" hint="Scales the whole interface, not just labels.">
          <div className="flex flex-wrap gap-1.5">
            {TEXT_SCALES.map((s) => (
              <Pill key={s.value} active={prefs.textScale === s.value} onClick={() => set("textScale", s.value)}>
                {s.label}
              </Pill>
            ))}
          </div>
        </Row>
        <Toggle
          label="Bold text"
          hint="Heavier body copy. Headings stay heavier than the text under them."
          on={prefs.boldText}
          onChange={(v) => set("boldText", v)}
        />
        <Toggle
          label="Reading comfort"
          hint="More space between lines and letters, and a narrower column."
          on={prefs.readingComfort}
          onChange={(v) => set("readingComfort", v)}
        />
      </Group>

      {/* ── Sight ─────────────────────────────────────────────────────────── */}
      <Group label="Sight">
        <Toggle
          label="High contrast"
          hint="Darker text and stronger borders throughout."
          on={prefs.highContrast}
          onChange={(v) => set("highContrast", v)}
        />
        <Toggle
          label="Reduce transparency"
          hint="Removes frosted-glass surfaces. Also lighter on the battery."
          on={prefs.reduceTransparency}
          onChange={(v) => set("reduceTransparency", v)}
        />
        <Row label="Colour filter" hint="Simulates colour blindness — useful for checking a design as well as using one.">
          <div className="flex flex-wrap gap-1.5">
            {COLOR_FILTERS.map((f) => (
              <Pill key={f.value} active={prefs.colorFilter === f.value} onClick={() => set("colorFilter", f.value)}>
                {f.label}
              </Pill>
            ))}
          </div>
        </Row>
      </Group>

      {/* ── Motion & touch ────────────────────────────────────────────────── */}
      <Group label="Motion & touch">
        <Row
          label="Animation"
          hint="“Follow device” uses your system setting — the default, and right for most people."
        >
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["system", "Follow device"],
                ["reduce", "Reduce"],
                ["full", "Full"],
              ] as const
            ).map(([value, label]) => (
              <Pill key={value} active={prefs.motion === value} onClick={() => set("motion", value)}>
                {label}
              </Pill>
            ))}
          </div>
        </Row>
        <Toggle
          label="Large tap targets"
          hint="Every button at least 44px — the size that works with a tremor or on a moving bus."
          on={prefs.tapTargets === "large"}
          onChange={(v) => set("tapTargets", v ? "large" : "default")}
        />
        <Toggle
          label="Strong focus ring"
          hint="A thicker, higher-contrast outline when moving by keyboard."
          on={prefs.strongFocus}
          onChange={(v) => set("strongFocus", v)}
        />
        {/*
          🔴 HAPTICS HAD NO OFF SWITCH AT ALL (owner, 2026-08-30: "make users to
          be able to turn off and on haptic click sound in profile settings").

          `playSound` has been gated on a stored preference since it was
          written; `haptic()` was not gated on anything, so all ~40 call sites
          vibrated unconditionally with no way to stop them. The settings
          registry has advertised "Haptics & sounds" as live on this page the
          whole time — the sounds half existed, the haptics half did not.

          Device-local rather than account-synced on purpose: this is about the
          hardware in your hand, and syncing it would silence your tablet
          because you silenced your phone. See lib/motion/haptic-prefs.ts.
        */}
        <Toggle
          label="Vibration on tap"
          hint="The short buzz when you tap a button, send, or pull to refresh. Turning this off is per-device."
          on={haptics}
          onChange={(v) => {
            setHaptics(v);
            setHapticsEnabled(v);
            // Fired AFTER the write, so turning it ON confirms itself with the
            // very feedback being enabled — and turning it off stays silent.
            if (v) haptic("selection");
          }}
        />
        {/*
          The tap SOUND deliberately stays where it already lives.

          `masterEnabled` is an account-synced preference with its own editor and
          its own server route. A second toggle here would be a second writer for
          one value — and the local-only setter available on this page would
          silently not persist, so the switch would flip back on next load. A
          pointer to the real control is honest; a control that forgets is not.
        */}
        <Row
          label="Sound on tap"
          hint="The soft click when you tap. Lives with every other Frenz sound, because it is synced to your account rather than this device."
        >
          <Link
            href="/account/notifications"
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-secondary"
          >
            Sounds
          </Link>
        </Row>
      </Group>

      {isCustomised(prefs) ? (
        <button
          type="button"
          onClick={() => {
            haptic("selection");
            commit({ ...DEFAULT_A11Y });
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-semibold transition hover:bg-secondary"
        >
          <RotateCcw className="h-4 w-4" /> Reset everything
        </button>
      ) : null}

      {/*
        Said plainly rather than implied. Someone configuring accessibility is
        entitled to know where the setting lives and what it does NOT do.
      */}
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        These settings are saved on this device only, so a phone and a laptop can differ. Frenz also respects your
        system settings for motion, contrast and text size — screen readers, zoom and voice control are handled by your
        device and work throughout the app.
      </p>
    </div>
  );
}

/* ─────────────────────────────────── pieces ───────────────────────────────── */

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</h2>
      {hint ? <p className="mb-2 px-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className={cn("overflow-hidden rounded-2xl border border-border/70 bg-card", hint ? "" : "mt-2")}>
        <div className="divide-y divide-border/60">{children}</div>
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-3">
      <p className="text-sm font-semibold">{label}</p>
      {hint ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl px-3 py-1.5 text-xs font-bold transition active:scale-95",
        active ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A real `role="switch"` with `aria-checked`, not a styled checkbox.
 *
 * On an accessibility screen especially, the control must announce what it is
 * and what state it is in — a div that looks like a switch is exactly the thing
 * this page exists to stop shipping.
 */
function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-secondary/40"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{hint}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition",
          on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
        )}
      >
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform",
            on ? "translate-x-4" : "translate-x-0",
          )}
        >
          {on ? <Check className="h-3 w-3 text-primary" /> : null}
        </span>
      </span>
    </button>
  );
}
