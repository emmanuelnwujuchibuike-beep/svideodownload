"use client";

import { ChevronDown, ChevronUp, Eye, EyeOff, Loader2, Settings2 } from "lucide-react";
import { useState, useTransition } from "react";

import { toast } from "@/features/ui/toast";
import {
  MAX_PINNED_METRICS,
  moveWidget,
  STUDIO_METRICS,
  STUDIO_WIDGETS,
  widgetDef,
  type MetricId,
  type WidgetId,
} from "@/lib/creator/widgets";
import { cn } from "@/lib/utils";

/**
 * Dashboard customisation (Feature 15 · Part 9).
 *
 * Imports the catalogue from `lib/creator/widgets.ts`, which is PURE — no
 * Supabase, no server-only. `lib/creator/prefs.ts` imports from that same file
 * in the other direction. Part 8's Orbit rail shipped a client component that
 * reached a server-only module through a type import and `next build` failed
 * where `tsc` was happy; starting split is what prevents the repeat.
 *
 * Reorder is buttons, not drag. On a phone a drag inside a scrolling sheet
 * fights the scroll, and for a keyboard or screen-reader user a drag handle is
 * usually nothing at all — two buttons work identically for everyone.
 */

export function StudioCustomiser({
  initialOrder,
  initialHidden,
  initialMetrics,
  initialGoal,
}: {
  initialOrder: WidgetId[];
  initialHidden: WidgetId[];
  initialMetrics: MetricId[];
  initialGoal: number;
}) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<WidgetId[]>(initialOrder);
  const [hidden, setHidden] = useState<WidgetId[]>(initialHidden);
  const [metrics, setMetrics] = useState<MetricId[]>(initialMetrics);
  const [goal, setGoal] = useState(initialGoal);
  const [pending, start] = useTransition();
  const [saving, setSaving] = useState(false);

  const save = (patch: Record<string, unknown>) => {
    setSaving(true);
    void fetch("/api/studio/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        // The page is server-rendered from these prefs, so a refresh is what
        // makes the change visible — the local state is only for the panel.
        start(() => window.location.reload());
      })
      .catch(() => toast("Couldn't save that layout.", "error"))
      .finally(() => setSaving(false));
  };

  const toggleHidden = (id: WidgetId) => {
    const def = widgetDef(id);
    if (def?.required) {
      toast("That one can't be hidden — the dashboard has to say something.", "info");
      return;
    }
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  };

  const toggleMetric = (id: MetricId) => {
    setMetrics((m) => {
      if (m.includes(id)) return m.filter((x) => x !== id);
      if (m.length >= MAX_PINNED_METRICS) {
        toast(`Four at a time — unpin one first.`, "info");
        return m;
      }
      return [...m, id];
    });
  };

  return (
    <section id="customise" className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Settings2 className="h-4 w-4 text-primary" aria-hidden />
          Customise your Studio
        </span>
        {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
      </button>

      {open ? (
        <div className="mt-5 space-y-6">
          <div>
            <h3 className="mb-1 text-xs font-semibold">Weekly upload goal</h3>
            <p className="mb-2.5 text-[11px] text-muted-foreground">
              Progress is counted from posts you actually publish. Zero means no goal.
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="weekly-goal" className="sr-only">
                Posts per week
              </label>
              <input
                id="weekly-goal"
                type="number"
                min={0}
                max={100}
                value={goal}
                onChange={(e) => setGoal(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-24 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-xs text-muted-foreground">posts per week</span>
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold">Pinned metrics</h3>
            <p className="mb-2.5 text-[11px] text-muted-foreground">
              Up to {MAX_PINNED_METRICS} appear in the strip at the top.
            </p>
            <div className="flex flex-wrap gap-2">
              {STUDIO_METRICS.map((m) => {
                const on = metrics.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMetric(m.id)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                      on
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold">Cards and their order</h3>
            <p className="mb-2.5 text-[11px] text-muted-foreground">
              Hidden cards stop being rendered at all, so they cost nothing.
            </p>
            <ul className="space-y-1.5">
              {order.map((id, i) => {
                const def = widgetDef(id);
                if (!def) return null;
                const isHidden = hidden.includes(id);
                return (
                  <li
                    key={id}
                    className={cn(
                      "flex items-center gap-2 rounded-2xl border border-border/60 bg-secondary/25 px-3 py-2",
                      isHidden && "opacity-55",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{def.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{def.blurb}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setOrder((o) => moveWidget(o, id, -1))}
                      disabled={i === 0}
                      aria-label={`Move ${def.label} up`}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrder((o) => moveWidget(o, id, 1))}
                      disabled={i === order.length - 1}
                      aria-label={`Move ${def.label} down`}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleHidden(id)}
                      aria-label={isHidden ? `Show ${def.label}` : `Hide ${def.label}`}
                      aria-pressed={isHidden}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                    >
                      {isHidden ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <button
            type="button"
            disabled={saving || pending}
            onClick={() =>
              save({ widgetOrder: order, hiddenWidgets: hidden, pinnedMetrics: metrics, weeklyGoal: goal })
            }
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {saving || pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            Save layout
          </button>
        </div>
      ) : null}
    </section>
  );
}
