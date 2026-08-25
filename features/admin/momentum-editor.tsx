"use client";

import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MomentumSettings } from "@/lib/social/momentum";
import { cn } from "@/lib/utils";

/**
 * Admin → Momentum Engine™ weights (Feature 15 Part 8). Same shape as
 * TrendingEditor on purpose — a different score (rising vs. big), the same
 * admin-tunable pattern (settings table, a save + a recompute-now button).
 * Recompute rides the SAME /api/cron/trending endpoint TrendingEditor's own
 * button calls — momentum was added to that cron rather than given its own
 * (see app/api/cron/trending/route.ts), so there's only one "recompute now"
 * action for an admin to reach for either score.
 */
export function MomentumEditor({ settings }: { settings: MomentumSettings }) {
  const router = useRouter();
  const [state, setState] = useState<MomentumSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (k: keyof MomentumSettings, v: number) => setState((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/momentum", {
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
      setMsg(
        res.ok
          ? { ok: true, text: `Recomputed ${json.momentumUpdated ?? 0} posts.` }
          : { ok: false, text: json.error ?? "Failed." },
      );
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
    <section className="mt-6 rounded-3xl border border-border bg-card px-3 py-6 sm:px-6 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <TrendingUp className="h-5 w-5 text-primary" /> Momentum Engine™
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
        Surfaces RISING posts/creators, not just big ones — engagement relative to a post&apos;s own short
        age, plus real watch-completion. A separate score from Trending on purpose.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label}>Completion weight</label>
          <input type="number" step="0.5" min={0} className={input} value={state.wCompletion} onChange={(e) => set("wCompletion", Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className={label}>Velocity weight</label>
          <input type="number" step="0.5" min={0} className={input} value={state.wVelocity} onChange={(e) => set("wVelocity", Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className={label}>Repost weight</label>
          <input type="number" step="0.5" min={0} className={input} value={state.wRepost} onChange={(e) => set("wRepost", Number(e.target.value) || 0)} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Gravity (decay)</label>
          <input type="number" step="0.1" min={0} className={input} value={state.gravity} onChange={(e) => set("gravity", Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className={label}>Window (hours)</label>
          <input
            type="number"
            min={1}
            className={input}
            value={state.maxAgeHours}
            onChange={(e) => set("maxAgeHours", Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          />
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
