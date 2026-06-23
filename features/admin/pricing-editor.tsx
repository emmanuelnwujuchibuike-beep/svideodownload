"use client";

import { Loader2, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { cn } from "@/lib/utils";

interface Tier {
  name: string;
  price: string;
  period: string;
}
interface Pricing {
  pro: Tier;
  business: Tier;
}

export function PricingEditor({ pricing }: { pricing: Pricing }) {
  const router = useRouter();
  const [pro, setPro] = useState<Tier>(pricing.pro);
  const [business, setBusiness] = useState<Tier>(pricing.business);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pro, business }),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Pricing updated — live on /pricing." }
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
        <Tag className="h-5 w-5 text-primary" /> Pricing
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Edit the prices shown on <code className="font-mono">/pricing</code>. The
        amount actually charged is set on your Paystack plan — keep them matched.
      </p>

      <form onSubmit={save} className="grid gap-5 sm:grid-cols-2">
        <TierFields label="Pro" tier={pro} onChange={setPro} />
        <TierFields label="Business" tier={business} onChange={setBusiness} />
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save pricing
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

function TierFields({
  label,
  tier,
  onChange,
}: {
  label: string;
  tier: Tier;
  onChange: (t: Tier) => void;
}) {
  const input =
    "h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary";
  return (
    <div className="rounded-2xl border border-border/70 bg-secondary/20 p-4">
      <p className="mb-3 text-sm font-semibold">{label}</p>
      <div className="space-y-2">
        <label className="block text-xs text-muted-foreground">Display name</label>
        <input className={input} value={tier.name} onChange={(e) => onChange({ ...tier, name: e.target.value })} />
        <label className="block text-xs text-muted-foreground">Price (with symbol)</label>
        <input
          className={input}
          value={tier.price}
          placeholder="₦2,500"
          onChange={(e) => onChange({ ...tier, price: e.target.value })}
        />
        <label className="block text-xs text-muted-foreground">Period</label>
        <input
          className={input}
          value={tier.period}
          placeholder="/mo"
          onChange={(e) => onChange({ ...tier, period: e.target.value })}
        />
      </div>
    </div>
  );
}
