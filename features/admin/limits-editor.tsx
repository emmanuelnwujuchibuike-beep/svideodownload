"use client";

import { Loader2, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { cn } from "@/lib/utils";

interface Caps {
  dailyDownloads: number;
  apiDailyLimit: number;
}
type Plan = "free" | "pro" | "business";
type Limits = Record<Plan, Caps>;

const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
};

export function LimitsEditor({ limits }: { limits: Limits }) {
  const router = useRouter();
  const [state, setState] = useState<Limits>(limits);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const update = (plan: Plan, field: keyof Caps, value: number) =>
    setState((s) => ({ ...s, [plan]: { ...s[plan], [field]: value } }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/plan-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Limits updated — enforced within a minute." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <SlidersHorizontal className="h-5 w-5 text-primary" /> Plan limits
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Daily caps per plan. Downloads beyond the cap return 429; API calls past
        the cap return 429 too (counted per user across all their keys).
      </p>

      <form onSubmit={save} className="grid gap-5 sm:grid-cols-3">
        {(Object.keys(PLAN_LABELS) as Plan[]).map((plan) => (
          <div key={plan} className="rounded-2xl border border-border/70 bg-secondary/20 p-4">
            <p className="mb-3 text-sm font-semibold">{PLAN_LABELS[plan]}</p>
            <div className="space-y-3">
              <Field
                label="Downloads / day"
                value={state[plan].dailyDownloads}
                onChange={(v) => update(plan, "dailyDownloads", v)}
              />
              <Field
                label="API requests / day"
                value={state[plan].apiDailyLimit}
                onChange={(v) => update(plan, "apiDailyLimit", v)}
              />
            </div>
          </div>
        ))}
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save limits
          </button>
          {msg ? (
            <span className={cn("ml-3 text-sm", msg.ok ? "text-green-500" : "text-red-400")}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground">{label}</label>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="mt-1 h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}
