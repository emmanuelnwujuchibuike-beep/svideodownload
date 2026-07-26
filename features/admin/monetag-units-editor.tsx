"use client";

import { AlertTriangle, Check, Plus, Trash2 } from "lucide-react";

import {
  MONETAG_AD_TYPES,
  parseMonetagSnippet,
  type MonetagAdType,
  type MonetagUnit,
} from "@/lib/monetization/monetag";
import { cn } from "@/lib/utils";

/**
 * Per-type Monetag tags editor. A CONTROLLED component: it holds no state of its
 * own and reports every change up via `onChange`, so the parent
 * (`MonetizationSettings`) keeps the single settings object and the single save
 * path. Two components each POSTing their own copy of the settings would clobber
 * each other's fields — this avoids that entirely.
 *
 * Each row is a Monetag format + the `<script>` snippet pasted from the dashboard.
 * The snippet is PARSED live (never injected) so the operator sees the zone id
 * that was extracted and a clear warning when a snippet can't be read — the same
 * "no silent empty box" discipline as the ad slots.
 */
export function MonetagUnitsEditor({
  units,
  onChange,
  disabled,
}: {
  units: MonetagUnit[];
  onChange: (next: MonetagUnit[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<MonetagUnit>) =>
    onChange(units.map((u, i) => (i === index ? { ...u, ...patch } : u)));

  const remove = (index: number) => onChange(units.filter((_, i) => i !== index));

  const add = () =>
    onChange([...units, { type: "in_page_push" as MonetagAdType, snippet: "" }]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Monetag ad types</h4>
        <span className="text-xs text-muted-foreground">
          {units.length} {units.length === 1 ? "tag" : "tags"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Monetag&apos;s formats differ from a banner network&apos;s — In-Page Push, Push Notifications,
        Vignette Banner and OnClick / Popunder are each a separate site-level tag with its own zone.
        Add one row per Monetag zone; paste the <code className="font-mono">&lt;script&gt;</code> from
        <em> Get tag</em> in your Monetag dashboard. The primary Multitag stays in the field above.
      </p>

      {units.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 bg-secondary/20 p-3 text-xs text-muted-foreground">
          No per-type Monetag tags yet. Use the Multitag above for everything at once, or add a
          specific format below (e.g. Push Notifications, OnClick).
        </p>
      ) : null}

      <div className="space-y-3">
        {units.map((unit, index) => {
          const parsed = parseMonetagSnippet(unit.snippet);
          const hasSnippet = unit.snippet.trim().length > 0;
          const isRisky = unit.type === "onclick_popunder" || unit.type === "push_notification";
          return (
            <div
              key={index}
              className="space-y-2 rounded-2xl border border-border/70 bg-secondary/20 p-3.5"
            >
              <div className="flex items-center gap-2">
                <select
                  value={unit.type}
                  disabled={disabled}
                  onChange={(e) => update(index, { type: e.target.value as MonetagAdType })}
                  className="h-9 flex-1 rounded-lg bg-background px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-border focus:ring-primary"
                >
                  {MONETAG_AD_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(index)}
                  aria-label="Remove this Monetag tag"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground ring-1 ring-inset ring-border transition hover:text-red-500 hover:ring-red-500/40 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <p className="text-[11px] text-muted-foreground">
                {MONETAG_AD_TYPES.find((t) => t.id === unit.type)?.description}
              </p>

              <textarea
                value={unit.snippet}
                disabled={disabled}
                onChange={(e) => update(index, { snippet: e.target.value })}
                placeholder={'<script src="//example.monetag.com/tag.min.js" data-zone="1234567" data-cfasync="false"></script>'}
                className="min-h-[64px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
              />

              {hasSnippet && parsed ? (
                <p className="flex items-center gap-1.5 text-[11px] text-green-500">
                  <Check className="h-3.5 w-3.5" />
                  Reads as a valid tag{parsed.zone ? ` · zone ${parsed.zone}` : ""}.
                </p>
              ) : hasSnippet ? (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This doesn&apos;t look like a Monetag script tag — only a clean{" "}
                  <code className="font-mono">https</code> <code className="font-mono">src</code> is
                  used, so it will render nothing until fixed.
                </p>
              ) : null}

              {isRisky ? (
                <p className="text-[11px] text-muted-foreground/70">
                  {unit.type === "onclick_popunder"
                    ? "OnClick takes over the visitor's next click and can affect an AdSense review."
                    : "Push may also be verified via the service worker (already merged into /sw.js)."}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={add}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3.5 py-2 text-sm font-medium text-foreground transition hover:border-foreground/30 disabled:opacity-60"
      >
        <Plus className="h-4 w-4" /> Add Monetag tag
      </button>

      <p className={cn("text-[11px] text-muted-foreground")}>
        Tags save with the <strong>Save Monetag &amp; AdSense details</strong> button below, and only
        serve while the <strong>Monetag</strong> switch above is on.
      </p>
    </div>
  );
}
