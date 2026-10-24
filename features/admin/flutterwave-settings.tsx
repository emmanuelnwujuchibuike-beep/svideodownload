"use client";

import { CheckCircle2, Copy, CreditCard, KeyRound, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FlutterwaveConnectionTest, FlutterwaveTransactions } from "@/features/admin/flutterwave-transactions";
import { useSensitiveAction } from "@/features/admin/use-sensitive-action";
import { cn } from "@/lib/utils";

/**
 * Admin: configure Flutterwave from the dashboard, like Paystack (owner, 2026-10-23) — the API secret key,
 * the webhook secret hash (and the webhook URL to paste into Flutterwave), and the capability switches that
 * decide whether a checkout may open on Flutterwave at all. Saved in a PRIVATE table (0272) that no browser
 * session can read; the secrets are write-only here (a mask and their source are all that come back). A
 * value set in Vercel env still works as the fallback. Nothing here makes a payment; saving needs the
 * admin password again (lib/admin/reauth.ts).
 */

type Source = "dashboard" | "env" | "none";
type Purpose = "wallet_topup" | "sub_purchase" | "verification" | "ad_campaign" | "ai_subscription" | "site_subscription";
interface Loaded {
  mode: "test" | "live" | null;
  secretSet: boolean;
  secretMasked: string;
  secretSource: Source;
  hashSet: boolean;
  hashMasked: string;
  hashSource: Source;
  verifiedCurrencies: string[];
  enabledPurposes: Purpose[];
  amountUnitConfirmed: boolean;
  sitePlanPro: string;
  sitePlanBusiness: string;
  sitePlanProNgn: string;
  sitePlanBusinessNgn: string;
  checkoutCurrency: string;
  webhookUrl: string;
  gates: Record<Purpose, { ok: true } | { ok: false; reason: string }>;
  storageReady: boolean;
}

const PURPOSES: { id: Purpose; label: string }[] = [
  { id: "wallet_topup", label: "AI credit top-ups" },
  { id: "sub_purchase", label: "Creator subscriptions (SUB)" },
  { id: "verification", label: "Paid verification (blue tick)" },
  { id: "ad_campaign", label: "Ad campaigns" },
  { id: "ai_subscription", label: "AI plans (Pro / Max) — USD payment plans, card" },
  { id: "site_subscription", label: "Pro / Business plans — USD payment plans, card" },
];

const REASON: Record<string, string> = {
  not_configured: "no secret key",
  webhook_secret_missing: "no webhook secret hash",
  amount_unit_unconfirmed: "amount unit not confirmed",
  currency_not_verified: "USD not confirmed",
  purpose_disabled: "switched off",
};

const SOURCE_LABEL: Record<Source, string> = { dashboard: "set here", env: "from Vercel env", none: "not set" };

function randomHash(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function FlutterwaveSettings() {
  const { sensitiveFetch, reauthPrompt } = useSensitiveAction();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [secretKey, setSecretKey] = useState("");
  const [secretHash, setSecretHash] = useState("");
  const [usd, setUsd] = useState(false);
  // 2026-10-24: naira for members in Nigeria (bank transfer, USSD…) — lib/payments/flutterwave-charge.ts
  const [ngn, setNgn] = useState(false);
  const [unitConfirmed, setUnitConfirmed] = useState(false);
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [sitePlanPro, setSitePlanPro] = useState("");
  const [sitePlanBusiness, setSitePlanBusiness] = useState("");
  // 2026-10-24: naira plans for card renewals in Nigeria
  const [sitePlanProNgn, setSitePlanProNgn] = useState("");
  const [sitePlanBusinessNgn, setSitePlanBusinessNgn] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/flutterwave", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as Loaded;
      setLoaded(d);
      setUsd(d.verifiedCurrencies.includes(d.checkoutCurrency));
      setNgn(d.verifiedCurrencies.includes("NGN"));
      setUnitConfirmed(d.amountUnitConfirmed);
      setPurposes(d.enabledPurposes);
      setSitePlanPro(d.sitePlanPro ?? "");
      setSitePlanBusiness(d.sitePlanBusiness ?? "");
      setSitePlanProNgn(d.sitePlanProNgn ?? "");
      setSitePlanBusinessNgn(d.sitePlanBusinessNgn ?? "");
    } catch {
      /* leave the form empty */
    }
  }, []);
  useEffect(() => void load(), [load]);

  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        verifiedCurrencies: [...(usd ? [loaded?.checkoutCurrency ?? "USD"] : []), ...(ngn ? ["NGN"] : [])],
        enabledPurposes: purposes,
        // an explicit "unconfirmed" (not blank): blank now means the ON default (2026-10-24)
        amountUnit: unitConfirmed ? "major" : "unconfirmed",
        sitePlanPro: sitePlanPro.trim(),
        sitePlanBusiness: sitePlanBusiness.trim(),
        sitePlanProNgn: sitePlanProNgn.trim(),
        sitePlanBusinessNgn: sitePlanBusinessNgn.trim(),
        ...extra,
      };
      // secrets only when typed (blank = keep the saved one)
      if (secretKey.trim()) body.secretKey = secretKey.trim();
      if (secretHash.trim()) body.secretHash = secretHash.trim();
      const res = await sensitiveFetch("/api/admin/flutterwave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string };
      if (res.ok) {
        setMsg({ ok: true, text: "Flutterwave saved." });
        setSecretKey("");
        setSecretHash("");
        await load();
      } else setMsg({ ok: false, text: json.error ?? "Couldn't save." });
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* the field is selectable */
    }
  };

  const openPurposes = loaded ? PURPOSES.filter((p) => loaded.gates[p.id]?.ok).length : 0;
  const input = "h-10 w-full rounded-lg bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary";

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/15 to-amber-500/15 text-orange-500 ring-1 ring-inset ring-orange-500/20">
            <CreditCard className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-bold">Flutterwave</h3>
            <p className="text-xs text-muted-foreground">Primary rail, charging USD. Paystack stays the backup. Set here, no redeploy.</p>
          </div>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", openPurposes ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-amber-500/12 text-amber-600 dark:text-amber-300")}>
          {openPurposes ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {openPurposes ? `Live for ${openPurposes} · ${loaded?.mode ?? ""}` : "Off — Paystack takes every payment"}
        </span>
      </div>

      {loaded && !loaded.storageReady ? (
        <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Run migration <b>0272_payment_provider_settings.sql</b> in Supabase first — until then these settings can&apos;t be saved (Vercel env still works).
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Secret key (FLWSECK…) — ${loaded ? SOURCE_LABEL[loaded.secretSource] : "…"}`} full>
          <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={loaded?.secretSet ? `Saved: ${loaded.secretMasked} — type to replace` : "FLWSECK_TEST-… or FLWSECK-…"} autoComplete="off" className={input} />
        </Field>
        <Field label="Webhook URL — paste into Flutterwave → Settings → Webhooks" full>
          <div className="flex gap-2">
            <input readOnly value={loaded?.webhookUrl ?? ""} className={cn(input, "text-muted-foreground")} />
            <button type="button" onClick={() => loaded && copy("url", loaded.webhookUrl)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-semibold">
              <Copy className="h-3.5 w-3.5" /> {copied === "url" ? "Copied" : "Copy"}
            </button>
          </div>
        </Field>
        <Field label={`Webhook secret hash — ${loaded ? SOURCE_LABEL[loaded.hashSource] : "…"}`} full>
          <div className="flex gap-2">
            <input value={secretHash} onChange={(e) => setSecretHash(e.target.value)} placeholder={loaded?.hashSet ? `Saved: ${loaded.hashMasked} — type or generate to replace` : "the same value as Flutterwave's “Secret hash”"} autoComplete="off" className={input} />
            <button type="button" onClick={() => setSecretHash(randomHash())} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-semibold">
              <KeyRound className="h-3.5 w-3.5" /> Generate
            </button>
            {secretHash ? (
              <button type="button" onClick={() => copy("hash", secretHash)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-semibold">
                <Copy className="h-3.5 w-3.5" /> {copied === "hash" ? "Copied" : "Copy"}
              </button>
            ) : null}
          </div>
          <span className="mt-1 block text-[11px] text-muted-foreground">Paste this exact value into Flutterwave&apos;s “Secret hash” before saving here — it is shown only now.</span>
        </Field>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Account capability — tick only what Flutterwave has CONFIRMED</p>
        <Check checked={usd} onChange={setUsd} label="Flutterwave confirmed in writing that this account can collect USD" />
        <Check checked={ngn} onChange={setNgn} label="Charge members in Nigeria in naira (NGN) — shows bank transfer, USSD and other local methods (one-off payments; plans stay USD card)" />
        <Check checked={unitConfirmed} onChange={setUnitConfirmed} label="A sandbox charge proved amounts are in dollars (major units), e.g. 5 = $5.00" />
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Use Flutterwave first for</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PURPOSES.map((p) => {
            const g = loaded?.gates[p.id];
            return (
              <div key={p.id} className="rounded-xl border border-border/70 p-2.5">
                <Check checked={purposes.includes(p.id)} onChange={(on) => setPurposes((cur) => (on ? [...new Set([...cur, p.id])] : cur.filter((x) => x !== p.id)))} label={p.label} />
                <p className={cn("mt-1 pl-6 text-[11px]", g?.ok ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground")}>
                  {g ? (g.ok ? "Live on Flutterwave" : `Paystack — ${REASON[g.reason] ?? g.reason}`) : "…"}
                </p>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">AI plans also need each plan&apos;s Flutterwave plan id (AI Plans card). Payouts stay on Paystack.</p>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Pro / Business plans — Flutterwave payment-plan ids (USD). Blank = that plan uses Paystack only.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <SitePlanField label="Pro plan id" plan="pro" value={sitePlanPro} onChange={setSitePlanPro} />
          <SitePlanField label="Business plan id" plan="business" value={sitePlanBusiness} onChange={setSitePlanBusiness} />
          <SitePlanField label="Pro NAIRA plan id — card renewals in Nigeria (optional)" value={sitePlanProNgn} onChange={setSitePlanProNgn} />
          <SitePlanField label="Business NAIRA plan id — card renewals in Nigeria (optional)" value={sitePlanBusinessNgn} onChange={setSitePlanBusinessNgn} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => save()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:opacity-95 active:scale-[0.98] disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Flutterwave
        </button>
        {loaded?.secretSource === "dashboard" ? (
          <button type="button" disabled={busy} onClick={() => save({ clearSecretKey: true })} className="text-xs font-semibold text-red-500 hover:underline">Remove saved key</button>
        ) : null}
        {loaded?.hashSource === "dashboard" ? (
          <button type="button" disabled={busy} onClick={() => save({ clearSecretHash: true })} className="text-xs font-semibold text-red-500 hover:underline">Remove saved hash</button>
        ) : null}
        {msg ? <span className={cn("text-sm font-medium", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
        {reauthPrompt}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Keys: Flutterwave dashboard → Settings → API Keys (use the <b>test</b> key first). Webhooks: Settings → Webhooks → set the URL above, the same secret hash, tick
        “Receive webhook for charge” and enable retries. The key and hash are stored where no browser — admin included — can read them back.
      </p>
      <div className="mt-4">
        <FlutterwaveConnectionTest />
      </div>
      <BillingReviews />
      <FlutterwaveTransactions />
    </section>
  );
}

interface Review {
  id: string;
  kind: "renewal" | "activation" | "cancellation" | "upgrade";
  reason: string;
  status: string;
  transaction_id: string | null;
  target: "ai_subscription" | "site_subscription" | null;
  user_id: string | null;
  subscription_ref: string | null;
  plan_code: string | null;
  amount_minor: number | null;
  currency: string | null;
  created_at: string;
}

const KIND_LABEL: Record<Review["kind"], string> = { renewal: "Renewal", activation: "Activation", cancellation: "Cancellation", upgrade: "Upgrade" };

/**
 * Part 3.3: Flutterwave plan billing that waits for a person (0274 plan_billing_reviews) — renewals whose subscription
 * could not be proven, unconfirmed activations and cancellations, an old subscription still charging after an upgrade.
 * Part 3.3.2: "Apply" appears only when Flutterwave CAN prove which subscription a renewal belongs to (the
 * sandbox-confirmed lookup); the server then re-verifies the charge and re-proves ownership before extending ONCE.
 * Everything else is labelled "Ownership not proven" — an email or a paid amount is never shown as proof. The server
 * stays authoritative: a stale page that still offers Apply just gets the refusal.
 */
function BillingReviews() {
  const { sensitiveFetch, reauthPrompt } = useSensitiveAction();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proofAvailable, setProofAvailable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/flutterwave/reviews", { cache: "no-store" });
      const json = (await res.json()) as { reviews?: Review[]; renewalProofAvailable?: boolean; error?: string };
      if (res.ok) {
        setReviews(json.reviews ?? []);
        setProofAvailable(json.renewalProofAvailable === true);
        setError(null);
      } else setError(json.error ?? "Couldn't load the reviews.");
    } catch {
      setError("Network error.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const act = async (id: string, action: "apply" | "resolve" | "dismiss") => {
    setBusyId(id);
    setNotice(null);
    setError(null);
    try {
      const body = action === "apply" ? { id, action } : { id, action, note: "" };
      const res = await sensitiveFetch("/api/admin/flutterwave/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; result?: string };
      if (!res.ok) setError(json.error ?? "Couldn't update the review.");
      else if (action === "apply") setNotice(json.result === "already_applied" ? "That payment was already applied — the review is closed." : "Ownership proven by Flutterwave — renewal applied once.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-5 space-y-2 border-t border-border/50 pt-4">
      <p className="text-xs font-semibold text-muted-foreground">Plan billing waiting for review {reviews ? `(${reviews.length})` : ""}</p>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-600 dark:text-emerald-300">{notice}</p> : null}
      {!proofAvailable ? (
        <p className="text-[11px] text-muted-foreground">Renewals can&apos;t be applied from here yet: Flutterwave has not been proven (sandbox check) to tell us which subscription a renewal belongs to.</p>
      ) : null}
      {reviews && !reviews.length ? <p className="text-xs text-muted-foreground">Nothing waiting.</p> : null}
      {reviews?.map((r) => (
        <div key={r.id} className="rounded-xl border border-border/70 p-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              {KIND_LABEL[r.kind]} · {r.target === "site_subscription" ? "Pro / Business" : r.target === "ai_subscription" ? "AI plan" : "plan unknown"}
              {r.amount_minor && r.currency ? ` · ${r.currency} ${(r.amount_minor / 100).toFixed(2)}` : ""}
            </span>
            <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
          </div>
          <p className="mt-1 text-muted-foreground">{r.reason}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {r.transaction_id ? `tx ${r.transaction_id} · ` : ""}
            {r.subscription_ref ? `subscription ${r.subscription_ref} · ` : ""}
            {r.plan_code ? `plan ${r.plan_code} · ` : ""}
            {r.user_id ? `member ${r.user_id.slice(0, 8)}…` : "member unknown"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {r.kind === "renewal" && r.transaction_id && proofAvailable ? (
              <button type="button" disabled={busyId === r.id} onClick={() => act(r.id, "apply")} className="rounded-lg bg-primary px-2.5 py-1 font-semibold text-primary-foreground disabled:opacity-50">
                Check ownership with Flutterwave &amp; apply
              </button>
            ) : r.kind === "renewal" ? (
              <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-700 dark:text-amber-300">Ownership not proven — resolve or dismiss</span>
            ) : null}
            <button type="button" disabled={busyId === r.id} onClick={() => act(r.id, "resolve")} className="rounded-lg border border-border px-2.5 py-1 font-semibold disabled:opacity-50">
              Mark resolved
            </button>
            <button type="button" disabled={busyId === r.id} onClick={() => act(r.id, "dismiss")} className="rounded-lg px-2.5 py-1 text-muted-foreground hover:underline disabled:opacity-50">
              Dismiss
            </button>
          </div>
        </div>
      ))}
      {reauthPrompt}
    </div>
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

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-500" />
      <span>{label}</span>
    </label>
  );
}

/** A site plan's Flutterwave payment-plan id, with "Check" — read back from Flutterwave (name, amount, interval) before it is saved. */
function SitePlanField({ label, plan, value, onChange }: { label: string; plan?: "pro" | "business"; value: string; onChange: (v: string) => void }) {
  const [check, setCheck] = useState<{ busy: boolean; ok: boolean; text: string | null }>({ busy: false, ok: false, text: null });
  const run = async () => {
    setCheck({ busy: true, ok: false, text: null });
    try {
      const res = await fetch("/api/admin/ai/plans/verify-flutterwave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan ? { id: value.trim(), for: plan } : { id: value.trim() }) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; usable?: boolean; checkoutCurrency?: string; compat?: { ok: boolean; detail?: string } | null; plan?: { name: string; amountMinor: number | null; currency: string; interval: string; active: boolean } } | null;
      if (json?.ok && json.plan && json.compat) {
        // Part 6: the same rule checkout applies — active, USD, monthly, and EQUAL to the /pricing price members see
        const p = json.plan;
        const amount = p.amountMinor === null ? "no fixed amount" : `${p.currency} ${(p.amountMinor / 100).toFixed(2)}`;
        setCheck({ busy: false, ok: json.compat.ok, text: json.compat.ok ? `"${p.name}" — ${amount} ${p.interval}, equal to the price on /pricing. It will be used.` : `"${p.name}" — ${amount} ${p.interval}. Won't be used: ${json.compat.detail}` });
      } else if (json?.ok && json.plan) {
        const p = json.plan;
        // a site plan has no list price of its own: without a fixed amount on Flutterwave it can't be sold there
        const amount = p.amountMinor === null ? "no fixed amount — set one on Flutterwave, or this plan won't be used" : `${p.currency} ${(p.amountMinor / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        const warn = !p.active ? " — not active, it will not be used." : p.currency !== json.checkoutCurrency ? ` — not ${json.checkoutCurrency}, it will not be used.` : ".";
        setCheck({ busy: false, ok: !!json.usable && p.amountMinor !== null, text: `"${p.name}" — ${amount} ${p.interval}${warn}` });
      } else setCheck({ busy: false, ok: false, text: json?.error ?? "Flutterwave did not answer." });
    } catch {
      setCheck({ busy: false, ok: false, text: "Network error." });
    }
  };
  return (
    <div className="rounded-xl border border-border/70 p-2.5">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="e.g. 123456" className="h-10 w-full rounded-lg bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary" />
        <button type="button" disabled={!value.trim() || check.busy} onClick={run} className="shrink-0 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-50">
          {check.busy ? "…" : "Check"}
        </button>
      </div>
      {check.text ? <p className={cn("mt-1 text-[11px]", check.ok ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300")}>{check.text}</p> : null}
    </div>
  );
}
