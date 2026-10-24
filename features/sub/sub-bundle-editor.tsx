"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import type { SubBounds } from "@/features/sub/sub-tab";
import { saveSubSettings } from "@/features/sub/sub-settings-client";
import { usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";
import { BUNDLE_MONTHS, effectiveMonthlyCents, savingsCents, savingsPercent, validateBundlePrice, type BundleMonths, type BundlePrices } from "@/lib/sub/pricing";
import { cn } from "@/lib/utils";

/**
 * The 3 / 6 / 12-month bundles in the Subscriptions dashboard's Price panel (0277). Each is its own switch and total;
 * beside it the effective monthly price and the saving against paying monthly — shown only when it is real. The
 * server checks every total again (saveSubSettings → validateBundlePrice): the bounds here are only a preview.
 */
export function SubBundleEditor({ monthlyCents, initial, bounds, ready, onSaved }: { monthlyCents: number | null; initial: BundlePrices; bounds: SubBounds; ready: boolean; onSaved: (b: BundlePrices) => void }) {
  const [on, setOn] = useState<Record<BundleMonths, boolean>>({ 3: initial[3] !== null, 6: initial[6] !== null, 12: initial[12] !== null });
  const [text, setText] = useState<Record<BundleMonths, string>>({ 3: initial[3] ? (initial[3] / 100).toFixed(2) : "", 6: initial[6] ? (initial[6] / 100).toFixed(2) : "", 12: initial[12] ? (initial[12] / 100).toFixed(2) : "" });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (!ready) return <p className="m-0 mt-3 text-[12.5px] text-frenz-muted">3, 6 and 12-month bundles arrive with the next update.</p>;
  if (!monthlyCents) return <p className="m-0 mt-3 text-[12.5px] text-frenz-muted">Save a monthly price first, then add bundles.</p>;

  const cents = (m: BundleMonths) => Math.round(Number(text[m]) * 100);
  const problem = (m: BundleMonths): string | null => {
    if (!on[m]) return null;
    if (!text[m]) return "Enter a total price.";
    const v = validateBundlePrice(cents(m), m, bounds);
    return v.ok ? null : v.error;
  };
  const invalid = BUNDLE_MONTHS.some((m) => problem(m) !== null);

  const save = async () => {
    if (invalid || saving) return;
    haptic("selection");
    setSaving(true);
    setNote(null);
    const next = { 3: on[3] ? cents(3) : null, 6: on[6] ? cents(6) : null, 12: on[12] ? cents(12) : null } as BundlePrices;
    const r = await saveSubSettings({ bundlePrices: { "3": next[3], "6": next[6], "12": next[12] } });
    setSaving(false);
    if (!r.ok) {
      setNote({ ok: false, text: r.error ?? "Couldn't save the bundles. Try again." });
      return;
    }
    onSaved(next);
    setNote({ ok: true, text: "Bundles saved — they apply to new subscriptions." });
  };

  return (
    <div className="mt-4">
      <p className="m-0 text-[13px] font-semibold text-frenz-muted">Bundles — paid once, nothing renews</p>
      <div className="mt-2 flex flex-col gap-2">
        {BUNDLE_MONTHS.map((m) => {
          const c = cents(m);
          const valid = on[m] && problem(m) === null;
          const saved = valid ? savingsCents(c, m, monthlyCents) : 0;
          const pct = valid ? savingsPercent(c, m, monthlyCents) : 0;
          const err = text[m] ? problem(m) : null;
          return (
            <div key={m} className="rounded-2xl bg-frenz-fill px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-[14.5px] font-semibold">{m} months</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on[m]}
                  aria-label={`Offer a ${m}-month bundle`}
                  onClick={() => {
                    haptic("selection");
                    setOn({ ...on, [m]: !on[m] });
                  }}
                  className="-m-[7px] flex h-11 w-16 shrink-0 items-center justify-center"
                >
                  <span className={cn("flex h-[30px] w-[50px] rounded-full p-0.5 transition-colors", on[m] ? "justify-end bg-frenz-violet" : "justify-start bg-[#E2DFEC] dark:bg-white/20")}>
                    <span className="h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)]" />
                  </span>
                </button>
              </div>
              {on[m] ? (
                <>
                  <label className="mt-1.5 flex items-center gap-2">
                    <span className="text-[13px] text-frenz-muted">Total (USD)</span>
                    <input
                      inputMode="decimal"
                      value={text[m]}
                      aria-label={`${m}-month total price in US dollars`}
                      onChange={(ev) => setText({ ...text, [m]: ev.target.value.replace(/[^0-9.]/g, "").slice(0, 9) })}
                      className="h-10 min-w-0 flex-1 rounded-xl border-0 bg-frenz-card px-3 text-base tabular-nums text-frenz-ink outline-none focus:ring-2 focus:ring-frenz-violet/40"
                    />
                  </label>
                  {valid ? (
                    <p className="m-0 mt-1 text-[12.5px] text-frenz-muted">
                      {usd(effectiveMonthlyCents(c, m))} a month · {saved > 0 ? <span className="font-semibold text-emerald-600 dark:text-emerald-400">saves {usd(saved)} ({pct}%) vs monthly</span> : "no saving vs paying monthly"}
                    </p>
                  ) : err ? (
                    <p className="m-0 mt-1 text-[12.5px] text-rose-600 dark:text-rose-400">{err}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => void save()} disabled={invalid || saving} aria-busy={saving} className="mt-2.5 flex h-11 items-center gap-1.5 rounded-full bg-frenz-ink px-5 text-[14px] font-bold text-frenz-page disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {saving ? "Saving…" : "Save bundles"}
      </button>
      {note ? <p role="status" className={cn("m-0 mt-1.5 text-[12.5px] font-medium", note.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{note.text}</p> : null}
    </div>
  );
}
