"use client";

import { Flame, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TrendingSettings } from "@/lib/social/feed";
import { cn } from "@/lib/utils";

const WEIGHTS: { key: keyof TrendingSettings; label: string }[] = [
  { key: "wView", label: "View" },
  { key: "wDownload", label: "Download" },
  { key: "wLike", label: "Like" },
  { key: "wSave", label: "Save" },
  { key: "wShare", label: "Share" },
  { key: "wComment", label: "Comment" },
];

export function TrendingEditor({ settings }: { settings: TrendingSettings }) {
  const router = useRouter();
  const [state, setState] = useState<TrendingSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (k: keyof TrendingSettings, v: number) => setState((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/trending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      setMsg(res.ok ? { ok: true, text: "Saved. Recompute to apply." } : { ok: false, text: json.error ?? "Failed." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const recompute = async () => {
    setRecomputing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cron/trending", { method: "POST" });
      const json = await res.json();
      setMsg(res.ok ? { ok: true, text: `Recomputed ${json.updated ?? 0} posts.` } : { ok: false, text: json.error ?? "Failed." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setRecomputing(false);
    }
  };

  const input =
    "h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary";
  const label = "mb-1 block text-xs font-medium text-muted-foreground";

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Flame className="h-5 w-5 text-primary" /> Trending
        </h2>
        <button
          type="button"
          onClick={recompute}
          disabled={recomputing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium transition hover:bg-secondary disabled:opacity-60"
        >
          {recomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recompute now
        </button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Signal weights, time-decay (gravity), freshness window and per-creator
        diversity. Changes apply on the next recompute (hourly cron or the button).
      </p>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {WEIGHTS.map((w) => (
          <div key={w.key}>
            <label className={label}>{w.label}</label>
            <input
              type="number"
              step="0.5"
              min={0}
              className={input}
              value={state[w.key]}
              onChange={(e) => set(w.key, Number(e.target.value) || 0)}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <label className={label}>Gravity (decay)</label>
          <input type="number" step="0.1" min={0} className={input} value={state.gravity} onChange={(e) => set("gravity", Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className={label}>Window (hours)</label>
          <input type="number" min={1} className={input} value={state.maxAgeHours} onChange={(e) => set("maxAgeHours", Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </div>
        <div>
          <label className={label}>Diversity / creator</label>
          <input type="number" min={1} className={input} value={state.diversityCap} onChange={(e) => set("diversityCap", Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <label className={label}>Min creator trust (feed)</label>
          <input type="number" min={0} max={100} className={input} value={state.feedTrustMin} onChange={(e) => set("feedTrustMin", Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))))} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save weights
        </button>
        {msg ? <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
    </section>
  );
}
