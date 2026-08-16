"use client";

import { Gift, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PromoDuration, PromoSettings } from "@/lib/monetization/promo";
import { cn } from "@/lib/utils";

const DURATION_LABELS: Record<PromoDuration, string> = {
  "1week": "1 week",
  "2weeks": "2 weeks",
  "1month": "1 month",
};

function fmtRemaining(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return "ending now";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
}

/**
 * "Set up a promo system where admin can activate a 1week or 1month or 2
 * weeks, depends on the promo, free pro plan for users in a certain period
 * and can turn it off at anytime" (owner, 2026-08-16).
 *
 * Every free-plan resolution (lib/monetization/plan.ts's `getUserPlan`)
 * checks this — while a promo is running, "free" resolves to "pro" site-
 * wide. It never touches an actual paying subscriber's real plan.
 */
export function PromoEditor({ initial }: { initial: PromoSettings }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [duration, setDuration] = useState<PromoDuration>("1week");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isRunning = state.active && (state.endsAt === null || state.endsAt > Date.now());

  const activate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", duration }),
      });
      const json = await res.json();
      if (res.ok) {
        setState(json);
        setMsg({ ok: true, text: `Free Pro is on for ${DURATION_LABELS[duration]}.` });
        router.refresh();
      } else {
        setMsg({ ok: false, text: json.error ?? "Failed to activate." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate" }),
      });
      const json = await res.json();
      if (res.ok) {
        setState(json);
        setMsg({ ok: true, text: "Promo turned off." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: json.error ?? "Failed to turn off." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Gift className="h-5 w-5 text-primary" /> Free Pro promo
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Give every free/signed-out visitor Pro entitlements (no ads, higher
        download caps, batch downloads) for a limited run. Never affects
        someone already on a real paid plan.
      </p>

      {isRunning ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
          </span>
          <span className="text-sm text-muted-foreground">
            {state.endsAt !== null ? fmtRemaining(state.endsAt) : "no end date set"}
          </span>
          <button
            type="button"
            onClick={deactivate}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3.5 py-2 text-sm font-semibold transition hover:bg-secondary disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Turn off
          </button>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl bg-secondary/60 p-1">
            {(Object.keys(DURATION_LABELS) as PromoDuration[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                  duration === d ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {DURATION_LABELS[d]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={activate}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Activate
          </button>
        </div>
      )}

      {msg ? (
        <p className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</p>
      ) : null}
    </section>
  );
}
