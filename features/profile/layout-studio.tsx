"use client";

import {
  Camera,
  Check,
  Code2,
  GraduationCap,
  LayoutGrid,
  Loader2,
  Minus,
  RotateCcw,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { checkAccent } from "@/lib/profile/color";
import { LAYOUT_PRESETS } from "@/lib/profile/presets";
import {
  FONT_SCALES,
  PROFILE_THEMES,
  RADII,
  resolveProfileTheme,
  SURFACES,
  type FontScaleKey,
  type ProfileThemeKey,
  type RadiusKey,
  type SurfaceKey,
} from "@/lib/profile/theme";
import { cn } from "@/lib/utils";

const PRESET_ICONS: Record<string, LucideIcon> = {
  Minus,
  Sparkles,
  Camera,
  LayoutGrid,
  Code2,
  Store,
  GraduationCap,
  Users,
};

/**
 * Profile Layout Studio™ (Feature 18 · Part 16).
 *
 * ── The preview is the product ────────────────────────────────────────────────
 * Every control writes to local state first and the preview re-renders from the
 * SAME `resolveProfileTheme` the real profile uses — not a hand-built
 * approximation. That matters: a preview that is merely similar teaches people
 * to distrust it, and they end up saving, navigating to their profile, going
 * back, and repeating. Sharing the resolver means what you see is literally what
 * renders.
 *
 * ── Saving is explicit ────────────────────────────────────────────────────────
 * Appearance is the one area where instant-save is wrong. Trying five themes
 * would be five writes and five states your visitors could catch you in. So
 * changes are local until Save, and Cancel is a real escape.
 *
 * ── Accessibility is enforced, not advised ────────────────────────────────────
 * The accent warning below is computed by WCAG maths (`lib/profile/color.ts`),
 * and the profile CORRECTS an unreadable accent rather than rendering it. The
 * banner explains what happened instead of leaving the member wondering why
 * their colour looks different — silently changing someone's choice without
 * saying so is worse than the original problem.
 */
export function LayoutStudio({
  initial,
  accent,
}: {
  initial: { theme: string | null; surface: string | null; radius: string | null; fontScale: string | null };
  /** The member's own accent (Part 10), which overrides the theme's. */
  accent: string | null;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<string | null>(initial.theme);
  const [surface, setSurface] = useState<string | null>(initial.surface);
  const [radius, setRadius] = useState<string | null>(initial.radius);
  const [fontScale, setFontScale] = useState<string | null>(initial.fontScale);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty =
    theme !== initial.theme ||
    surface !== initial.surface ||
    radius !== initial.radius ||
    fontScale !== initial.fontScale;

  // The exact resolver the profile page uses — see the note above.
  const resolved = useMemo(
    () => resolveProfileTheme({ theme, surface, radius, fontScale, accent }),
    [theme, surface, radius, fontScale, accent],
  );
  const accentReport = accent ? checkAccent(accent) : null;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile/appearance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, surface, radius, font_scale: fontScale }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't save your theme." });
        return;
      }
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Back to the plain white default (owner, 2026-08-04).
   *
   * Writes NULLs rather than the default theme's key. A stored "default" and
   * no stored preference are different states: the second means "I have never
   * chosen", so the profile follows whatever the platform default becomes
   * later. Saving the current default freezes today's look forever, which is
   * not what "reset" means to anyone.
   *
   * It is also the one control that always works — a member who picked
   * something unreadable needs a way out that does not depend on them being
   * able to read the screen.
   */
  const resetToDefault = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile/appearance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: null, surface: null, radius: null, font_scale: null }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't reset your theme." });
        return;
      }
      setTheme(null);
      setSurface(null);
      setRadius(null);
      setFontScale(null);
      setMsg({ ok: true, text: "Back to the default look." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = async (key: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile/appearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: key }),
      });
      const json = (await res.json()) as { error?: string; partial?: string[] };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't apply that layout." });
        return;
      }
      const preset = LAYOUT_PRESETS.find((p) => p.key === key)!;
      setTheme(preset.theme);
      setSurface(preset.surface);
      setRadius(preset.radius);
      setFontScale(preset.fontScale);
      setMsg({
        ok: true,
        // A partial apply is reported, never glossed over.
        text: json.partial?.length
          ? `Applied — but ${json.partial.join(" and ")} couldn't be saved yet.`
          : "Layout applied. Everything is still yours to change.",
      });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* Live preview — a real profile card rendered with the resolved theme */}
      <section
        style={resolved.vars as React.CSSProperties}
        className="overflow-hidden rounded-3xl border border-border/70 shadow-sm"
      >
        <div
          className="h-24 w-full"
          style={{
            backgroundImage: `linear-gradient(135deg, var(--frenz-profile-wash-from), var(--frenz-profile-wash-to))`,
          }}
        />
        <div className="bg-background p-4">
          <div
            className="-mt-10 p-4"
            style={{
              background: "var(--frenz-profile-card-bg)",
              border: "var(--frenz-profile-card-border)",
              boxShadow: "var(--frenz-profile-card-shadow)",
              backdropFilter: "var(--frenz-profile-card-blur)",
              borderRadius: "var(--frenz-profile-radius)",
              fontSize: `calc(1rem * var(--frenz-profile-font-scale))`,
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="h-11 w-11 shrink-0 rounded-full"
                style={{ background: "var(--frenz-profile-accent)" }}
              />
              <span className="min-w-0">
                <span className="block truncate font-bold" style={{ fontSize: "1em" }}>
                  Your name
                </span>
                <span className="block truncate text-muted-foreground" style={{ fontSize: "0.8em" }}>
                  @yourhandle
                </span>
              </span>
            </div>
            <p className="mt-3 leading-relaxed text-muted-foreground" style={{ fontSize: "0.85em" }}>
              This is how a card on your profile will look.
            </p>
            <span
              className="mt-3 inline-flex items-center rounded-full px-3 py-1 font-semibold text-white"
              style={{ background: "var(--frenz-profile-accent)", fontSize: "0.75em" }}
            >
              Follow
            </span>
          </div>
        </div>
      </section>

      {/* Colour Intelligence — only speaks when something is actually wrong */}
      {resolved.accentCorrected && accentReport ? (
        <p className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          Your accent colour scores {Math.min(accentReport.onLight, accentReport.onDark).toFixed(1)}:1 against one of
          the two themes — under the 3:1 minimum for readable text, so some visitors couldn&apos;t see it. Your profile
          uses the closest shade of the same colour that passes.{" "}
          <span className="opacity-80">Pick a different accent in Identity to change it.</span>
        </p>
      ) : null}

      {/* Presets */}
      <section className="mt-5">
        <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Start from a layout</p>
        <p className="mt-0.5 px-1.5 text-xs text-muted-foreground">
          Sets your sections and theme in one go. Everything stays editable afterwards.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {LAYOUT_PRESETS.map((p) => {
            const Icon = PRESET_ICONS[p.icon] ?? Sparkles;
            return (
              <button
                key={p.key}
                type="button"
                disabled={busy}
                onClick={() => void applyPreset(p.key)}
                className="flex items-start gap-3 rounded-2xl border border-border/70 p-3.5 text-left transition hover:border-foreground/20 hover:bg-secondary/30 disabled:opacity-60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                  <Icon className="h-[17px] w-[17px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{p.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{p.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <Choice
        label="Theme"
        options={PROFILE_THEMES.map((t) => ({ key: t.key, label: t.label, blurb: t.blurb, swatch: t.accent }))}
        value={theme}
        onChange={(v) => setTheme(v as ProfileThemeKey)}
      />
      <Choice
        label="Cards"
        options={SURFACES.map((s) => ({ key: s.key, label: s.label, blurb: s.blurb }))}
        value={surface ?? resolved.surface}
        onChange={(v) => setSurface(v as SurfaceKey)}
      />
      <Choice
        label="Corners"
        options={RADII.map((r) => ({ key: r.key, label: r.label }))}
        value={radius ?? resolved.radius}
        onChange={(v) => setRadius(v as RadiusKey)}
      />
      <Choice
        label="Text size"
        options={FONT_SCALES.map((f) => ({ key: f.key, label: f.label }))}
        value={fontScale ?? resolved.fontScale}
        onChange={(v) => setFontScale(v as FontScaleKey)}
      />
      <p className="mt-2 px-1.5 text-[11px] leading-relaxed text-muted-foreground">
        Text size scales your profile relative to the size your device is already set to, so it stays readable however
        you have your phone configured.
      </p>

      <div className="sticky bottom-4 z-10 mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy || !dirty} className="btn-lux btn-lux-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {dirty ? "Save theme" : "Saved"}
        </button>
        {/* Deliberately NOT gated on `dirty`: the member who most needs this
            is the one whose SAVED theme is the problem, and they have nothing
            unsaved to discard. */}
        <button
          type="button"
          onClick={() => void resetToDefault()}
          disabled={busy || (theme === null && surface === null && radius === null && fontScale === null)}
          className="btn-lux btn-lux-secondary"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to default
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setTheme(initial.theme);
              setSurface(initial.surface);
              setRadius(initial.radius);
              setFontScale(initial.fontScale);
              setMsg(null);
            }}
            className="btn-lux btn-lux-secondary"
          >
            Cancel
          </button>
        ) : null}
        {msg ? (
          <p className={cn("text-sm font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>{msg.text}</p>
        ) : null}
      </div>
    </div>
  );
}

function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string; blurb?: string; swatch?: string }[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  return (
    <section className="mt-5">
      <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange(o.key)}
              aria-pressed={active}
              title={o.blurb}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                active ? "bg-brand-tile text-white shadow-sm" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {o.swatch ? (
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-full ring-1 ring-inset ring-black/10"
                  style={{ background: o.swatch }}
                />
              ) : null}
              {o.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
