"use client";

import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Admin: configure Paystack (test or live keys) from the dashboard — no env var, no
 * redeploy (owner). The secret is write-only: the form shows only a masked hint and
 * a "configured" flag; leaving the secret blank on save keeps the existing one. The
 * public key + plan codes are safe to show. The client code reads this config
 * server-side (lib/paystack/config.ts), falling back to env for an existing deploy.
 */
interface Loaded {
  mode: "test" | "live";
  secretSet: boolean;
  secretMasked: string;
  publicKey: string;
  planPro: string;
  planBusiness: string;
}

export function PaystackSettings() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mode, setMode] = useState<"test" | "live">("test");
  const [secretKey, setSecretKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [planPro, setPlanPro] = useState("");
  const [planBusiness, setPlanBusiness] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/paystack");
        if (!res.ok) return;
        const d = (await res.json()) as Loaded;
        setLoaded(d);
        setMode(d.mode);
        setPublicKey(d.publicKey);
        setPlanPro(d.planPro);
        setPlanBusiness(d.planBusiness);
      } catch {
        /* leave the form empty */
      }
    })();
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { mode, publicKey, planPro, planBusiness };
      // Only send the secret when the admin typed a new one (blank = keep existing).
      if (secretKey.trim()) body.secretKey = secretKey.trim();
      const res = await fetch("/api/admin/paystack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (res.ok) {
        setMsg({ ok: true, text: "Paystack saved." });
        setSecretKey("");
        setLoaded((l) => (l ? { ...l, secretSet: l.secretSet || !!body.secretKey, mode, publicKey, planPro, planBusiness } : l));
      } else {
        setMsg({ ok: false, text: json.error ?? "Couldn't save." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const configured = !!loaded?.secretSet || !!secretKey.trim();

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-emerald-500 ring-1 ring-inset ring-emerald-500/20">
            <CreditCard className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-bold">Paystack</h3>
            <p className="text-xs text-muted-foreground">Your test or live keys — set here, no redeploy.</p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
            configured ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-amber-500/12 text-amber-600 dark:text-amber-300",
          )}
        >
          {configured ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {configured ? `Configured · ${mode}` : "Not configured"}
        </span>
      </div>

      {/* Mode */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Mode</label>
        <div className="inline-flex rounded-xl bg-secondary p-1">
          {(["test", "live"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition",
                mode === m ? "bg-background shadow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Secret key (sk_…)" full>
          <input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder={loaded?.secretSet ? `Saved: ${loaded.secretMasked} — type to replace` : "sk_test_… or sk_live_…"}
            autoComplete="off"
            className="h-10 w-full rounded-lg bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Public key (pk_…)" full>
          <input
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="pk_test_… or pk_live_…"
            autoComplete="off"
            className="h-10 w-full rounded-lg bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Pro plan code (PLN_…)">
          <input value={planPro} onChange={(e) => setPlanPro(e.target.value)} placeholder="PLN_…" autoComplete="off" className="h-10 w-full rounded-lg bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary" />
        </Field>
        <Field label="Business plan code (PLN_…)">
          <input value={planBusiness} onChange={(e) => setPlanBusiness(e.target.value)} placeholder="PLN_…" autoComplete="off" className="h-10 w-full rounded-lg bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary" />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:opacity-95 active:scale-[0.98] disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Paystack
        </button>
        {msg ? <span className={cn("text-sm font-medium", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Get these from your Paystack dashboard → Settings → API Keys &amp; Webhooks. Use the <b>test</b> keys while
        integrating, then switch to <b>live</b>. The secret is stored securely and never shown again.
      </p>
    </section>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn("block", full && "sm:col-span-2")}>
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
