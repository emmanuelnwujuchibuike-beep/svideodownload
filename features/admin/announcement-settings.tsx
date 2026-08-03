"use client";

import { Check, Gift, Loader2, Megaphone, Rocket, Sparkles } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import type { Announcement, AnnouncementVariant } from "@/lib/announcement";
import { cn } from "@/lib/utils";

/**
 * Admin: set the premium announcement bar shown at the top of the home + download
 * pages. Persists to the `settings` table via /api/admin/announcement; the public
 * banner picks it up within a minute. Editing the copy re-shows it to anyone who
 * dismissed the previous one (the dismissal is keyed by a content hash).
 */
const VARIANTS: { id: AnnouncementVariant; label: string; icon: ComponentType<{ className?: string }>; bar: string }[] = [
  { id: "feature", label: "New feature", icon: Sparkles, bar: "from-violet-600 via-indigo-600 to-blue-600" },
  { id: "update", label: "Version update", icon: Rocket, bar: "from-emerald-600 via-teal-600 to-cyan-600" },
  { id: "announcement", label: "Announcement", icon: Megaphone, bar: "from-blue-600 via-sky-600 to-indigo-600" },
  { id: "promo", label: "Promo / offer", icon: Gift, bar: "from-amber-500 via-orange-500 to-rose-500" },
];

const EMPTY: Announcement = { enabled: false, message: "", ctaLabel: null, ctaHref: null, variant: "feature", dismissible: true };

export function AnnouncementSettings() {
  const [form, setForm] = useState<Announcement>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/announcement", { cache: "no-store" });
        if (res.ok) setForm({ ...EMPTY, ...(await res.json()) });
      } catch {
        /* keep defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof Announcement>(k: K, v: Announcement[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const active = VARIANTS.find((v) => v.id === form.variant) ?? VARIANTS[0]!;
  const ActiveIcon = active.icon;

  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-secondary/50" />;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold">Announcement bar</h3>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4 accent-primary" />
          {form.enabled ? "Live" : "Off"}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown at the top of the home and download pages — for announcements, version updates and new features. Not shown on social or content pages.
      </p>

      {/* Live preview */}
      <div className={cn("overflow-hidden rounded-xl bg-gradient-to-r text-white shadow", active.bar)}>
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          <ActiveIcon className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{form.message || "Your announcement preview…"}</p>
          {form.ctaLabel ? <span className="shrink-0 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-neutral-900">{form.ctaLabel}</span> : null}
        </div>
      </div>

      {/* Variant */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {VARIANTS.map((v) => {
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => set("variant", v.id)}
              aria-pressed={form.variant === v.id}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition active:scale-[0.98]",
                form.variant === v.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" /> {v.label}
            </button>
          );
        })}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">Message</span>
        <textarea
          value={form.message}
          onChange={(e) => set("message", e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="🎉 v2.4 is here — try the new Telegram downloader and premium history."
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Button label (optional)</span>
          <input
            value={form.ctaLabel ?? ""}
            onChange={(e) => set("ctaLabel", e.target.value || null)}
            maxLength={40}
            placeholder="What's new"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Button link (optional)</span>
          <input
            value={form.ctaHref ?? ""}
            onChange={(e) => set("ctaHref", e.target.value || null)}
            maxLength={500}
            placeholder="/features or https://…"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.dismissible} onChange={(e) => set("dismissible", e.target.checked)} className="h-4 w-4 accent-primary" />
          Let visitors dismiss it
        </label>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background transition active:scale-[0.97] disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? "Saved" : "Save announcement"}
        </button>
      </div>
    </section>
  );
}
