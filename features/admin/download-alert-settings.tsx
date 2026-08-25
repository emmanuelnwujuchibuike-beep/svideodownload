"use client";

import { BellRing, Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { DownloadAlertSettings } from "@/lib/analytics/download-alert-settings";
import { cn } from "@/lib/utils";

/**
 * The "🎉 N downloads" milestone email — interval and on/off.
 *
 * Owner, 2026-08-24: "put a way in admin dashboard, i can turn off, extend or
 * shorten the download threshold email alert from 100 to any number or turn it
 * off." It was `ALERT_DOWNLOAD_EVERY`, a build-time environment variable, so
 * every change meant editing Vercel and redeploying — and an empty value was
 * silently falsy.
 *
 * 🔴 Loads its own state rather than taking a server prop, so it can live
 * anywhere on this page without threading a fetch through the layout, and so
 * "Saved" always reflects what the server actually stored.
 */
export function DownloadAlertControls() {
  const [value, setValue] = useState<DownloadAlertSettings | null>(null);
  const [every, setEvery] = useState("100");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/admin/download-alerts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DownloadAlertSettings | null) => {
        if (!alive || !d) return;
        setValue(d);
        setEvery(String(d.every));
      })
      .catch(() => {
        if (alive) setError("Couldn't load the current setting.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(
    async (next: DownloadAlertSettings) => {
      setBusy(true);
      setError(null);
      setSaved(false);
      try {
        const res = await fetch("/api/admin/download-alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Save failed");
        setValue(next);
        setEvery(String(next.every));
        setSaved(true);
        setTimeout(() => setSaved(false), 2200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const enabled = value?.enabled ?? true;
  // Only a whole number ≥ 1 is a threshold; anything else would be saved as
  // the default and silently ignore what was typed.
  const parsed = Number.parseInt(every, 10);
  const validEvery = Number.isFinite(parsed) && parsed >= 1;
  const dirty = validEvery && parsed !== value?.every;

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <BellRing className="h-5 w-5 text-primary" /> Download milestone email
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        An email to the admin address every time total downloads cross a new multiple. Takes effect within a minute —
        no redeploy.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Email me every</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={every}
              disabled={!enabled || busy}
              onChange={(e) => setEvery(e.target.value)}
              className="w-32 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold tabular-nums outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            />
            <span className="text-sm text-muted-foreground">downloads</span>
          </span>
        </label>

        <button
          type="button"
          disabled={!enabled || busy || !dirty}
          onClick={() => save({ every: parsed, enabled: true })}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : "Save"}
        </button>

        <button
          type="button"
          disabled={busy || value === null}
          onClick={() => save({ every: validEvery ? parsed : (value?.every ?? 100), enabled: !enabled })}
          className={cn(
            "rounded-xl border px-4 py-2 text-sm font-semibold transition",
            enabled
              ? "border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
              : "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
            "disabled:opacity-50",
          )}
        >
          {enabled ? "Turn off" : "Turn on"}
        </button>

        {saved ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        ) : null}
        {error ? <span className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</span> : null}
      </div>

      <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        {value === null
          ? "Loading…"
          : enabled
            ? `On — the next email goes out at the next multiple of ${value.every.toLocaleString()}.`
            : "Off — no milestone emails are sent. Download recording and every other alert are unaffected."}{" "}
        Each milestone is emailed once, so a busy day cannot repeat one.
      </p>
    </section>
  );
}
