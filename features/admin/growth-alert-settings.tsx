"use client";

import { Check, Loader2, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { GrowthAlertCounter, GrowthAlertSettings } from "@/lib/analytics/growth-alert-settings";
import { cn } from "@/lib/utils";

/**
 * The "🎉 N visitors / members" milestone emails (owner, 2026-09-20) — two
 * intervals, two switches, saved to `settings.growth_alerts` through
 * /api/admin/growth-alerts. Mirrors the download milestone control beside it:
 * the number is a whole number ≥ 1, a save is explicit, and each milestone is
 * emailed once (`admin_alerts.key`), so a busy day cannot repeat one.
 */
export function GrowthAlertControls() {
  const [value, setValue] = useState<GrowthAlertSettings | null>(null);
  const [visitors, setVisitors] = useState("1000");
  const [users, setUsers] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/admin/growth-alerts", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<GrowthAlertSettings>) : null))
      .then((v) => {
        if (!alive || !v) return;
        setValue(v);
        setVisitors(String(v.visitors.every));
        setUsers(String(v.users.every));
      })
      .catch(() => {
        if (alive) setError("Couldn't load the milestone settings.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: GrowthAlertSettings) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/growth-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setValue(next);
      setVisitors(String(next.visitors.every));
      setUsers(String(next.users.every));
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }, []);

  const parse = (s: string) => {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  };
  const v = parse(visitors);
  const u = parse(users);
  const dirty = value !== null && v !== null && u !== null && (v !== value.visitors.every || u !== value.users.every);
  const current = (key: keyof GrowthAlertSettings, every: number | null): GrowthAlertCounter => ({ every: every ?? value?.[key].every ?? 1000, enabled: value?.[key].enabled ?? true });

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <TrendingUp className="h-5 w-5 text-primary" /> Visitor &amp; member milestone emails
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        An email to the admin address every time all-time unique visitors, or the number of members, crosses a new multiple. Checked
        daily by the digest run and as traffic arrives. Takes effect within a minute — no redeploy.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ["visitors", "Unique visitors", visitors, setVisitors, v],
            ["users", "Members", users, setUsers, u],
          ] as const
        ).map(([key, label, text, setText, parsed]) => {
          const enabled = value?.[key].enabled ?? true;
          return (
            <div key={key} className="rounded-2xl border border-border/60 p-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{label} — email me every</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={text}
                    disabled={!enabled || busy}
                    onChange={(e) => setText(e.target.value)}
                    className="w-32 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold tabular-nums outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                  />
                  <span className="text-sm text-muted-foreground">{key === "visitors" ? "visitors" : "members"}</span>
                </span>
              </label>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || value === null}
                  onClick={() => value && save({ ...value, [key]: { every: parsed ?? value[key].every, enabled: !enabled } })}
                  className={cn(
                    "rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                    enabled ? "border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400" : "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
                  )}
                >
                  {enabled ? "Turn off" : "Turn on"}
                </button>
                <span className="text-xs text-muted-foreground">
                  {value === null ? "Loading…" : enabled ? `On — next at the next multiple of ${value[key].every.toLocaleString()}.` : "Off."}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => value && save({ visitors: current("visitors", v), users: current("users", u) })}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : "Save"}
        </button>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        ) : null}
        {error ? <span className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</span> : null}
      </div>
    </section>
  );
}
