"use client";

import { Loader2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { cn } from "@/lib/utils";

interface Subscriber {
  email: string;
  plan: string;
  status: string;
  provider: string;
}

type Plan = "free" | "pro" | "business";

export function PlanManager({ subscribers }: { subscribers: Subscriber[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<Plan>("pro");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setUserPlan = async (targetEmail: string, targetPlan: Plan, key: string) => {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail, plan: targetPlan }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Failed." });
        return;
      }
      setMsg({
        ok: true,
        text:
          targetPlan === "free"
            ? `Removed ${targetEmail} from paid plan.`
            : `Set ${targetEmail} to ${targetPlan}.`,
      });
      setEmail("");
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) void setUserPlan(email.trim(), plan, "form");
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <UserPlus className="h-5 w-5 text-primary" /> Members &amp; plans
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Manually grant or remove Pro/Business by email. (Doesn&apos;t cancel a
        live Paystack subscription — use it for comps &amp; support.)
      </p>

      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@email.com"
          className="h-10 min-w-0 flex-1 rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as Plan)}
          className="h-10 rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border"
        >
          <option value="pro">Pro</option>
          <option value="business">Business</option>
          <option value="free">Free (remove)</option>
        </select>
        <button
          type="submit"
          disabled={busy === "form"}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy === "form" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
        </button>
      </form>

      {msg ? (
        <p className={cn("mt-3 text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</p>
      ) : null}

      <div className="mt-5 border-t border-border/60 pt-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Active subscribers ({subscribers.length})
        </p>
        {subscribers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No paid members yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {subscribers.map((s) => (
              <li key={s.email} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">{s.email}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      s.plan === "business" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {s.plan}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{s.provider}</span>
                  <button
                    type="button"
                    onClick={() => setUserPlan(s.email, "free", s.email)}
                    disabled={busy === s.email}
                    aria-label={`Remove ${s.email}`}
                    title="Remove from plan"
                    className="rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-red-400"
                  >
                    {busy === s.email ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
