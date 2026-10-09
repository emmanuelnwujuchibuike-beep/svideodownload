"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { quoteCharacterReplace } from "@/lib/ai/character-replace/pricing";
import { REPLACEMENT_MODES, replacementModeLabel } from "@/lib/ai/character-replace/modes";
import { AI_PLAN_IDS, AI_PLANS_BOUNDS, normalizeAiPlansConfig, type AiPlanId, type AiPlansConfig } from "@/lib/ai/credits/config";
import { AI_CREDIT_FEATURES, AI_FEATURE_LABELS, AI_FEATURES_BY_CHARACTER, AI_FEATURES_WITH_DURATION, AI_TIERS, type AiCreditFeatureId, type AiFeaturePolicies, type AiTier } from "@/lib/ai/credits/features";
import { PAYMENT_MARKETS, PAYMENT_PURPOSES, WALLET_BOUNDS, type PaymentRouting } from "@/lib/ai/credits/wallet-config";

const TIER_LABEL: Record<AiTier, string> = { free: "Free", ai_pro: "AI Pro", ai_max: "AI Max" };
type FeatureRow = { enabled: boolean; payAsYouGo: boolean; tiers: Record<AiTier, boolean>; multiplier: string; minimum: string; maxSeconds: string; included: Record<AiTier, string> };
import { calculateCredits } from "@/lib/ai/credits/engine";
import { formatCents } from "@/lib/ai/economy";
import { aiCurrencySymbol, majorInputToMinor, minorToMajorInput } from "@/lib/landing/bounds";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI PLANS & CREDITS — AI Pro, AI Max, the one-time creations, the credit rules
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "Create a dedicated: AI Plans & Credits section. Do NOT
 * overcrowd the existing dashboard … Admin should be able to edit AI Pro /
 * AI Max (enabled, price, billing interval, daily credits, weekly credits),
 * Free AI (one-time creations for Pro / Business), Credit calculation."
 *
 * Posts ONLY `frenzAiPlans` (deep-merged and clamped server-side; a change to
 * an entitlement- or cost-bearing value bumps the version stamped on every
 * later ledger row). The live example at the bottom runs the SAME engine the
 * server runs, on the values typed here, so the operator sees what a change
 * does before saving.
 */
const QUALITY_KEYS = ["480p", "720p", "1080p", "standard", "high", "ultra"] as const;
const ZONES = ["Africa/Lagos", "UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"];

const int = (raw: string, fallback: number) => {
  const n = Math.floor(Number(raw));
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};
const opt = (raw: string) => (raw.trim() === "" ? null : int(raw, 0));
const mult = (raw: string) => {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) ? 1 : n;
};

export function AiPlansSettingsPanel({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const cfg = settings.frenzAiPlans;
  const cr = settings.frenzAiCharacterReplace;
  const symbol = aiCurrencySymbol(settings.frenzAiCurrency);

  const [enabled, setEnabled] = useState(cfg.enabled);
  const [plans, setPlans] = useState<Record<AiPlanId, { enabled: boolean; label: string; price: string; interval: "monthly" | "yearly"; daily: string; weekly: string; code: string; bachs: string; creditsPrice: string; blurb: string }>>({
    ai_pro: { enabled: cfg.plans.ai_pro.enabled, label: cfg.plans.ai_pro.label, price: minorToMajorInput(cfg.plans.ai_pro.priceCents), interval: cfg.plans.ai_pro.interval, daily: String(cfg.plans.ai_pro.dailyCredits), weekly: String(cfg.plans.ai_pro.weeklyCredits), code: cfg.plans.ai_pro.paystackPlanCode, bachs: cfg.plans.ai_pro.bachsProductId, creditsPrice: String(cfg.plans.ai_pro.creditsPrice || ""), blurb: cfg.plans.ai_pro.blurb },
    ai_max: { enabled: cfg.plans.ai_max.enabled, label: cfg.plans.ai_max.label, price: minorToMajorInput(cfg.plans.ai_max.priceCents), interval: cfg.plans.ai_max.interval, daily: String(cfg.plans.ai_max.dailyCredits), weekly: String(cfg.plans.ai_max.weeklyCredits), code: cfg.plans.ai_max.paystackPlanCode, bachs: cfg.plans.ai_max.bachsProductId, creditsPrice: String(cfg.plans.ai_max.creditsPrice || ""), blurb: cfg.plans.ai_max.blurb },
  });
  const [freeEnabled, setFreeEnabled] = useState(cfg.freeCreations.enabled);
  const [freeCounts, setFreeCounts] = useState({ free: cfg.freeCreations.free === null ? "" : String(cfg.freeCreations.free), pro: cfg.freeCreations.pro === null ? "" : String(cfg.freeCreations.pro), business: cfg.freeCreations.business === null ? "" : String(cfg.freeCreations.business) });
  const [centsPerCredit, setCentsPerCredit] = useState(minorToMajorInput(cfg.credits.centsPerCredit));
  const [minimum, setMinimum] = useState(String(cfg.credits.minimumCredits));
  const [rounding, setRounding] = useState(cfg.credits.rounding);
  const [modeMult, setModeMult] = useState<Record<string, string>>(Object.fromEntries(REPLACEMENT_MODES.map((m) => [m, String(cfg.credits.modeMultiplier[m] ?? 1)])));
  const [qualityMult, setQualityMult] = useState<Record<string, string>>(Object.fromEntries(QUALITY_KEYS.map((q) => [q, String(cfg.credits.qualityMultiplier[q] ?? 1)])));
  const [walletFallback, setWalletFallback] = useState(cfg.walletFallback);
  // 0184: the credit packs a member buys, and which provider takes the payment
  const [packs, setPacks] = useState(cfg.wallet.packs.map((p) => ({ credits: String(p.credits), bonus: String(p.bonusCredits), enabled: p.enabled, highlight: p.highlight })));
  const [customEnabled, setCustomEnabled] = useState(cfg.wallet.custom.enabled);
  const [customMin, setCustomMin] = useState(String(cfg.wallet.custom.minCredits));
  const [customMax, setCustomMax] = useState(String(cfg.wallet.custom.maxCredits));
  const [provider] = useState(cfg.wallet.provider);
  // 2026-10-07: which rail takes a payment, per market and purpose (lib/payments/router.ts)
  const [routing, setRouting] = useState<PaymentRouting>(cfg.wallet.routing);
  const [memberChoice, setMemberChoice] = useState<boolean>(cfg.wallet.memberChoice);
  // 0193: member-to-member credit transfers
  const [xfer, setXfer] = useState({ enabled: cfg.wallet.transfers.enabled, fee: String(cfg.wallet.transfers.feePercent), depFee: String(cfg.wallet.transfers.depositedFeePercent), min: String(cfg.wallet.transfers.minCredits), max: String(cfg.wallet.transfers.maxCredits), daily: String(cfg.wallet.transfers.dailyMaxCredits) });
  // 0185: one row of rules per paid tool (lib/ai/credits/features.ts); the credit multiplier is credits.featureMultiplier
  const [features, setFeatures] = useState<Record<AiCreditFeatureId, FeatureRow>>(
    Object.fromEntries(
      AI_CREDIT_FEATURES.map((id) => {
        const p = cfg.features[id];
        return [id, { enabled: p.enabled, payAsYouGo: p.payAsYouGo, tiers: { ...p.tiers }, multiplier: String(cfg.credits.featureMultiplier[id] ?? 1), minimum: String(p.minimumCredits), maxSeconds: p.maxInputSeconds === null ? "" : String(p.maxInputSeconds), included: { free: String(p.monthlyIncluded.free), ai_pro: String(p.monthlyIncluded.ai_pro), ai_max: String(p.monthlyIncluded.ai_max) } }];
      }),
    ) as Record<AiCreditFeatureId, FeatureRow>,
  );
  const [timezone, setTimezone] = useState(cfg.reset.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(String(cfg.reset.weekStartsOn));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 2026-09-21: "Check with Paystack" — what the code really is before it is saved (a payment-page slug was pasted here once)
  const [codeCheck, setCodeCheck] = useState<Record<AiPlanId, { busy: boolean; text: string | null; ok: boolean }>>({ ai_pro: { busy: false, text: null, ok: false }, ai_max: { busy: false, text: null, ok: false } });
  const checkCode = async (id: AiPlanId) => {
    const code = plans[id].code.trim();
    setCodeCheck((c) => ({ ...c, [id]: { busy: true, text: null, ok: false } }));
    try {
      const res = await fetch("/api/admin/ai/plans/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; plan?: { name: string; amount: number; currency: string; interval: string; active: boolean } } | null;
      if (json?.ok && json.plan) {
        const major = (json.plan.amount / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
        const shown = `${symbol}${plans[id].price || "0"}`;
        setCodeCheck((c) => ({ ...c, [id]: { busy: false, ok: true, text: `Paystack: "${json.plan!.name}" — ${json.plan!.currency} ${major} ${json.plan!.interval}${json.plan!.active ? "" : " (archived!)"}. The card shows ${shown}/${plans[id].interval === "yearly" ? "year" : "month"}${json.plan!.currency !== settings.frenzAiCurrency ? " — a different currency; members are charged Paystack's amount." : "."}` } }));
      } else {
        setCodeCheck((c) => ({ ...c, [id]: { busy: false, ok: false, text: json?.error ?? "Paystack did not answer." } }));
      }
    } catch {
      setCodeCheck((c) => ({ ...c, [id]: { busy: false, ok: false, text: "Network error." } }));
    }
  };

  // 2026-10-07: "Check with Bachs" — the product as Bachs holds it (needs the key's products:read scope)
  const [bachsCheck, setBachsCheck] = useState<Record<AiPlanId, { busy: boolean; text: string | null; ok: boolean }>>({ ai_pro: { busy: false, text: null, ok: false }, ai_max: { busy: false, text: null, ok: false } });
  const checkBachs = async (id: AiPlanId) => {
    setBachsCheck((c) => ({ ...c, [id]: { busy: true, text: null, ok: false } }));
    try {
      const res = await fetch("/api/admin/ai/plans/verify-bachs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: plans[id].bachs.trim() }) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; product?: { name: string; amount: string | null; currency: string | null; interval: string | null; recurring: boolean } } | null;
      if (json?.ok && json.product) {
        const pr = json.product;
        setBachsCheck((c) => ({ ...c, [id]: { busy: false, ok: pr.recurring, text: `Bachs: "${pr.name}" — ${pr.currency ?? ""} ${pr.amount ?? "?"}${pr.interval ? ` / ${pr.interval}` : ""}${pr.recurring ? "" : " — NOT recurring: a one-off product cannot be a subscription."}` } }));
      } else {
        setBachsCheck((c) => ({ ...c, [id]: { busy: false, ok: false, text: json?.error ?? "Bachs did not answer." } }));
      }
    } catch {
      setBachsCheck((c) => ({ ...c, [id]: { busy: false, ok: false, text: "Network error." } }));
    }
  };

  const payload = useMemo(
    () => ({
      enabled,
      plans: Object.fromEntries(
        AI_PLAN_IDS.map((id) => [
          id,
          {
            enabled: plans[id].enabled,
            label: plans[id].label.trim() || cfg.plans[id].label,
            priceCents: majorInputToMinor(plans[id].price) ?? cfg.plans[id].priceCents,
            interval: plans[id].interval,
            dailyCredits: int(plans[id].daily, cfg.plans[id].dailyCredits),
            weeklyCredits: int(plans[id].weekly, cfg.plans[id].weeklyCredits),
            paystackPlanCode: plans[id].code.trim(),
            bachsProductId: plans[id].bachs.trim(),
            creditsPrice: plans[id].creditsPrice.trim() === "" ? 0 : int(plans[id].creditsPrice, 0),
            blurb: plans[id].blurb.trim() || cfg.plans[id].blurb,
          },
        ]),
      ) as AiPlansConfig["plans"],
      freeCreations: { enabled: freeEnabled, free: opt(freeCounts.free), pro: opt(freeCounts.pro), business: opt(freeCounts.business) },
      credits: {
        centsPerCredit: majorInputToMinor(centsPerCredit) ?? cfg.credits.centsPerCredit,
        minimumCredits: int(minimum, cfg.credits.minimumCredits),
        rounding,
        modeMultiplier: Object.fromEntries(Object.entries(modeMult).map(([k, v]) => [k, mult(v)])),
        qualityMultiplier: Object.fromEntries(Object.entries(qualityMult).map(([k, v]) => [k, mult(v)])),
        featureMultiplier: { ...cfg.credits.featureMultiplier, ...Object.fromEntries(AI_CREDIT_FEATURES.map((id) => [id, mult(features[id].multiplier)])) },
      },
      reset: { timezone: timezone.trim() || cfg.reset.timezone, weekStartsOn: int(weekStartsOn, cfg.reset.weekStartsOn) },
      walletFallback,
      wallet: {
        packs: packs.map((p) => ({ credits: int(p.credits, 0), bonusCredits: int(p.bonus, 0), enabled: p.enabled, highlight: p.highlight })).filter((p) => p.credits > 0),
        custom: { enabled: customEnabled, minCredits: int(customMin, cfg.wallet.custom.minCredits), maxCredits: int(customMax, cfg.wallet.custom.maxCredits) },
        provider,
        routing,
        memberChoice,
        transfers: { enabled: xfer.enabled, feePercent: Math.min(50, Math.max(0, Number(xfer.fee) || 0)), depositedFeePercent: Math.min(50, Math.max(0, Number(xfer.depFee) || 0)), minCredits: int(xfer.min, cfg.wallet.transfers.minCredits), maxCredits: int(xfer.max, cfg.wallet.transfers.maxCredits), dailyMaxCredits: int(xfer.daily, cfg.wallet.transfers.dailyMaxCredits) },
      },
      features: Object.fromEntries(
        AI_CREDIT_FEATURES.map((id) => {
          const f = features[id];
          return [id, { enabled: f.enabled, payAsYouGo: f.payAsYouGo, tiers: f.tiers, minimumCredits: int(f.minimum, 0), maxInputSeconds: f.maxSeconds.trim() === "" ? null : int(f.maxSeconds, 0), monthlyIncluded: { free: int(f.included.free, 0), ai_pro: int(f.included.ai_pro, 0), ai_max: int(f.included.ai_max, 0) } }];
        }),
      ) as AiFeaturePolicies,
    }),
    [centsPerCredit, cfg, customEnabled, features, routing, memberChoice, xfer, customMax, customMin, enabled, freeCounts, freeEnabled, minimum, modeMult, packs, plans, provider, qualityMult, rounding, timezone, walletFallback, weekStartsOn],
  );

  /* the same bounds the server enforces, refused before the request leaves */
  const problems = useMemo(() => {
    const out: string[] = [];
    const B = AI_PLANS_BOUNDS;
    for (const id of AI_PLAN_IDS) {
      const p = payload.plans[id];
      if (p.dailyCredits < B.dailyCredits.min || p.dailyCredits > B.dailyCredits.max) out.push(`${p.label}: daily credits must be ${B.dailyCredits.min}–${B.dailyCredits.max}.`);
      if (p.weeklyCredits < p.dailyCredits) out.push(`${p.label}: weekly credits cannot be below the daily figure.`);
      if (p.priceCents < 0) out.push(`${p.label}: the price cannot be negative.`);
      if (p.paystackPlanCode && !/^[A-Za-z0-9_-]{1,100}$/.test(p.paystackPlanCode)) out.push(`${p.label}: that doesn't look like a Paystack plan code (PLN_…).`);
    }
    if (payload.credits.centsPerCredit < B.centsPerCredit.min) out.push("A credit must be worth at least one minor unit.");
    if (payload.wallet.packs.length > WALLET_BOUNDS.packs) out.push(`At most ${WALLET_BOUNDS.packs} packs.`);
    if (new Set(payload.wallet.packs.map((p) => p.credits)).size !== payload.wallet.packs.length) out.push("Two packs have the same number of credits — each size can be one pack.");
    if (payload.wallet.custom.maxCredits < payload.wallet.custom.minCredits) out.push("The custom maximum is below the minimum.");
    for (const id of AI_CREDIT_FEATURES) {
      const f = payload.features[id];
      const m = payload.credits.featureMultiplier[id] ?? 1;
      if (m < B.multiplier.min || m > B.multiplier.max) out.push(`${AI_FEATURE_LABELS[id]}: the credit multiplier must be ${B.multiplier.min}–${B.multiplier.max}.`);
      if (f.maxInputSeconds !== null && f.maxInputSeconds < 1) out.push(`${AI_FEATURE_LABELS[id]}: a maximum length must be at least 1 second (blank = the tool's own).`);
    }
    for (const [k, v] of [...Object.entries(payload.credits.modeMultiplier), ...Object.entries(payload.credits.qualityMultiplier)]) if (v < B.multiplier.min || v > B.multiplier.max) out.push(`Multiplier ${k} must be ${B.multiplier.min}–${B.multiplier.max}.`);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: payload.reset.timezone });
    } catch {
      out.push(`"${payload.reset.timezone}" is not a time zone this server knows.`);
    }
    return out;
  }, [payload]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (!payload.enabled) out.push("The AI plans are OFF: nothing can be bought and no credits are spent; the wallet and the complimentary creations work as before.");
    for (const id of AI_PLAN_IDS) {
      const p = payload.plans[id];
      if (p.enabled && !p.paystackPlanCode && !p.bachsProductId) out.push(`${p.label} has neither a Paystack plan code nor a Bachs product — it is shown as coming soon and cannot be bought.`);
      else if (p.enabled && !p.bachsProductId && payload.wallet.routing.NG.ai_subscription.primary === "bachs") out.push(`${p.label} has no Bachs product: members in Nigeria will be sent to Paystack for it.`);
    }
    if (payload.walletFallback === "allow") out.push("Wallet fallback = allow: a plan member whose allowance is short is charged from their balance without being asked.");
    if (!payload.wallet.packs.some((p) => p.enabled) && !payload.wallet.custom.enabled) out.push("No pack is on and the custom amount is off: nobody can buy credits.");
    for (const id of AI_CREDIT_FEATURES) {
      const f = payload.features[id];
      if (!f.enabled) out.push(`${AI_FEATURE_LABELS[id]} is OFF for everyone.`);
      else if (!f.payAsYouGo && !AI_TIERS.some((t) => t !== "free" && f.tiers[t])) out.push(`${AI_FEATURE_LABELS[id]}: pay-as-you-go is off and no AI plan may use it — nobody can.`);
      else if (!f.payAsYouGo) out.push(`${AI_FEATURE_LABELS[id]}: wallet credits cannot pay for it — only an AI plan's allowance or included generations.`);
    }
    if (PAYMENT_MARKETS.some((m) => PAYMENT_PURPOSES.some((p) => payload.wallet.routing[m][p].primary === "bachs" || payload.wallet.routing[m][p].fallback === "bachs"))) out.push("Bachs is routed: it is only used while BACHS_SECRET_KEY and BACHS_WEBHOOK_SECRET are set on the server — until then those payments go to the other rail.");
    if (payload.walletFallback === "off") out.push("Wallet fallback = off: a plan member whose allowance is short can only upgrade — their balance is not offered for that generation.");
    return out;
  }, [payload]);

  /* the live example: the same engine the server runs, on the values typed here */
  const example = useMemo(() => {
    try {
      const normalized = normalizeAiPlansConfig({ ...payload, version: cfg.version });
      const money = { currency: settings.frenzAiCurrency, symbol };
      const rows = [
        { label: "5 s · Face Only · standard", input: { selectedDurationMs: 5000, mode: "face_only" as const, quality: "standard" as const, voiceMode: "original" as const, lipSyncMode: null } },
        { label: "5 s · Full Character · 720p", input: { selectedDurationMs: 5000, mode: "full_character" as const, quality: "720p" as const, voiceMode: "original" as const, lipSyncMode: null } },
        { label: "15 s · Full Character · 720p", input: { selectedDurationMs: 15000, mode: "full_character" as const, quality: "720p" as const, voiceMode: "original" as const, lipSyncMode: null } },
        { label: "10 s · Upper Body · high", input: { selectedDurationMs: 10000, mode: "upper_body" as const, quality: "high" as const, voiceMode: "original" as const, lipSyncMode: null } },
      ];
      return rows.map((r) => {
        const q = quoteCharacterReplace(r.input, cr, money);
        const c = calculateCredits({ feature: "ai_character_replace", priceCents: q.totalCents, mode: q.mode, quality: q.quality, durationMs: q.durationMs }, normalized);
        return { label: r.label, price: formatCents(q.totalCents, symbol), credits: c.creditsRequired };
      });
    } catch {
      return [];
    }
  }, [cfg.version, cr, payload, settings.frenzAiCurrency, symbol]);

  const submit = async () => {
    if (problems.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frenzAiPlans: payload }) });
      const json = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: "Saved. Applies to the next quote and the next reservation; past transactions keep the version they were made under." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const small = "mt-1 w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">AI Plans &amp; Credits</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        AI Pro and AI Max are subscriptions apart from Pro/Business: a member may hold both. A plan includes a daily and a weekly allowance of credits; a generation costs credits by its
        priced total (the Pricing tab) converted at the rate below. Both allowances must cover it. Prices shown to members come from here; Paystack charges each plan&apos;s own amount, so
        keep the two aligned.
      </p>

      <div className="space-y-6">
        <Toggle label="Offer AI plans" hint="Off: nothing can be bought and no credits are spent — the wallet and the complimentary creations work exactly as before." checked={enabled} onChange={setEnabled} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {AI_PLAN_IDS.map((id) => {
            const p = plans[id];
            const set = (patch: Partial<typeof p>) => setPlans((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
            return (
              <Group key={id} title={id === "ai_pro" ? "AI Pro" : "AI Max"}>
                <div className="space-y-3">
                  <Toggle label={`${p.label || (id === "ai_pro" ? "AI Pro" : "AI Max")} enabled`} hint="Off: the plan is hidden and cannot be bought; existing subscribers keep their credits until their period ends." checked={p.enabled} onChange={(v) => set({ enabled: v })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field id={`${id}-label`} label="Name"><input id={`${id}-label`} value={p.label} onChange={(e) => set({ label: e.target.value })} className={input} maxLength={24} /></Field>
                    <Field id={`${id}-price`} label={`Price (${symbol})`} hint="Display. Must match the Paystack plan.">
                      <input id={`${id}-price`} inputMode="decimal" value={p.price} onChange={(e) => set({ price: e.target.value })} className={input} />
                    </Field>
                    <Field id={`${id}-interval`} label="Billing interval">
                      <select id={`${id}-interval`} value={p.interval} onChange={(e) => set({ interval: e.target.value as "monthly" | "yearly" })} className={input}>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </Field>
                    <Field id={`${id}-code`} className="col-span-2" label="Paystack plan code" hint="Paystack dashboard → Payments → Plans → the plan → Plan code (PLN_…). Not the payment-page link. Empty = coming soon.">
                      <div className="mt-1 flex gap-2">
                        <input id={`${id}-code`} value={p.code} onChange={(e) => set({ code: e.target.value })} className={cn(input, "mt-0 min-w-0 flex-1")} placeholder="PLN_…" />
                        <button type="button" onClick={() => checkCode(id)} disabled={codeCheck[id].busy || !p.code.trim()} className="shrink-0 rounded-xl border border-border px-3 text-xs font-semibold disabled:opacity-50">
                          {codeCheck[id].busy ? "Checking…" : "Check with Paystack"}
                        </button>
                      </div>
                      {p.code.trim() && !/^PLN_[A-Za-z0-9]{4,60}$/.test(p.code.trim()) ? <span className="mt-1 block text-[11px] text-rose-600">Not a plan code — it must start with PLN_. Saving will leave the plan as “coming soon”.</span> : null}
                      {codeCheck[id].text ? <span className={cn("mt-1 block text-[11px] leading-relaxed", codeCheck[id].ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600")}>{codeCheck[id].text}</span> : null}
                    </Field>
                    <Field id={`${id}-credits-price`} label="Price when paid with credits" hint="Credits for one period of this plan. Empty = the plan price at the normal credit rate.">
                      <input id={`${id}-credits-price`} inputMode="numeric" value={p.creditsPrice} onChange={(e) => set({ creditsPrice: e.target.value.replace(/[^0-9]/g, "") })} placeholder="Normal rate" className={small} />
                    </Field>
                    <Field id={`${id}-bachs`} className="col-span-2" label="Bachs product (prod_…)" hint="Bachs dashboard → Products → this plan's RECURRING product (monthly, same price) → its id. Not a payment link: the id lets us tie the payment to the member. Empty = Bachs does not sell this plan.">
                      <div className="mt-1 flex gap-2">
                        <input id={`${id}-bachs`} value={p.bachs} onChange={(e) => set({ bachs: e.target.value })} className={cn(input, "mt-0 min-w-0 flex-1")} placeholder="prod_…" />
                        <button type="button" onClick={() => checkBachs(id)} disabled={bachsCheck[id].busy || !p.bachs.trim()} className="shrink-0 rounded-xl border border-border px-3 text-xs font-semibold disabled:opacity-50">
                          {bachsCheck[id].busy ? "Checking…" : "Check with Bachs"}
                        </button>
                      </div>
                      {p.bachs.trim() && !/^prod_[A-Za-z0-9]{4,60}$/.test(p.bachs.trim()) ? <span className="mt-1 block text-[11px] text-rose-600">Not a product id — it must start with prod_. A payment link can&apos;t be used here.</span> : null}
                      {bachsCheck[id].text ? <span className={cn("mt-1 block text-[11px] leading-relaxed", bachsCheck[id].ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600")}>{bachsCheck[id].text}</span> : null}
                    </Field>
                    <Field id={`${id}-daily`} label="Daily credits"><input id={`${id}-daily`} inputMode="numeric" value={p.daily} onChange={(e) => set({ daily: e.target.value })} className={input} /></Field>
                    <Field id={`${id}-weekly`} label="Weekly credits" hint="Both must cover a generation."><input id={`${id}-weekly`} inputMode="numeric" value={p.weekly} onChange={(e) => set({ weekly: e.target.value })} className={input} /></Field>
                  </div>
                  <Field id={`${id}-blurb`} label="One line on the plan card"><input id={`${id}-blurb`} value={p.blurb} onChange={(e) => set({ blurb: e.target.value })} className={input} maxLength={160} /></Field>
                </div>
              </Group>
            );
          })}
        </div>

        <Group title="Free AI — one-time complimentary creations">
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Lifetime, never daily: how many complimentary creations a member on each site plan is granted. Blank = the number on the Character Replace tab ({cr.freeAccess.creationsPerAccount}).
            The operator&apos;s CURRENT number is the entitlement — lowering or raising it applies at once; the account keeps counting uses. The device rule (max accounts per device) still applies.
          </p>
          <div className="space-y-3">
            <Toggle label="Grant complimentary creations" hint="Off: nobody is granted any; existing members' remaining ones are not usable while it is off." checked={freeEnabled} onChange={setFreeEnabled} />
            <div className="grid grid-cols-3 gap-3">
              {(["free", "pro", "business"] as const).map((k) => (
                <Field key={k} id={`free-${k}`} label={k === "free" ? "Free members" : k === "pro" ? "Pro members" : "Business members"}>
                  <input id={`free-${k}`} inputMode="numeric" value={freeCounts[k]} onChange={(e) => setFreeCounts((c) => ({ ...c, [k]: e.target.value }))} className={small} placeholder={String(cr.freeAccess.creationsPerAccount)} />
                </Field>
              ))}
            </div>
          </div>
        </Group>

        <Group title="Credit calculation">
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            credits = priced total ÷ value of a credit × tool × scope × quality multipliers, rounded, at least the minimum. The priced total already carries duration, scope, tier, trim,
            voice and lip sync from the Pricing tab — one formula, one place.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field id="credit-value" label={`One credit = ${symbol}`} hint="What a credit is worth."><input id="credit-value" inputMode="decimal" value={centsPerCredit} onChange={(e) => setCentsPerCredit(e.target.value)} className={small} /></Field>
            <Field id="credit-min" label="Minimum per generation"><input id="credit-min" inputMode="numeric" value={minimum} onChange={(e) => setMinimum(e.target.value)} className={small} /></Field>
            <Field id="credit-rounding" label="Rounding">
              <select id="credit-rounding" value={rounding} onChange={(e) => setRounding(e.target.value as "ceil" | "nearest")} className={small}>
                <option value="ceil">Round up</option>
                <option value="nearest">Nearest</option>
              </select>
            </Field>
            <Field id="wallet-fallback" label="When credits run short" hint="For plan members only.">
              <select id="wallet-fallback" value={walletFallback} onChange={(e) => setWalletFallback(e.target.value as "allow" | "ask" | "off")} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                <option value="ask">Ask — upgrade or pay from balance</option>
                <option value="allow">Charge the balance as before</option>
                <option value="off">Upgrade only</option>
              </select>
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Scope multipliers</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {REPLACEMENT_MODES.map((m) => (
                  <Field key={m} id={`mult-${m}`} label={replacementModeLabel(m)}><input id={`mult-${m}`} inputMode="decimal" value={modeMult[m] ?? "1"} onChange={(e) => setModeMult((x) => ({ ...x, [m]: e.target.value }))} className={small} /></Field>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Quality multipliers</p>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {QUALITY_KEYS.map((q) => (
                  <Field key={q} id={`qmult-${q}`} label={q}><input id={`qmult-${q}`} inputMode="decimal" value={qualityMult[q] ?? "1"} onChange={(e) => setQualityMult((x) => ({ ...x, [q]: e.target.value }))} className={small} /></Field>
                ))}
              </div>
            </div>
          </div>
          {example.length ? (
            <div className="mt-4 rounded-2xl bg-secondary/50 px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground">With these numbers (today&apos;s prices)</p>
              <ul className="mt-1.5 grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2">
                {example.map((e) => (
                  <li key={e.label} className="flex items-baseline justify-between gap-3">
                    <span>{e.label}</span>
                    <span className="tabular-nums">
                      <span className="text-muted-foreground">{e.price} → </span>
                      <span className="font-semibold">{e.credits} credit{e.credits === 1 ? "" : "s"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Group>

        <Group title="AI features — the rules for each tool">
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Cost in credits = the tool&apos;s priced total (its own pricing tab) ÷ the credit value × the multiplier here, at least the minimum. Tiers: who may use it (Free, or an
            active AI plan). Included: generations a month that cost nothing, per tier — Text to Audio counts characters and Voice Cloning free voices on their own tabs, so they have
            none here. Blank maximum = the tool&apos;s own limit.
          </p>
          <div className="space-y-3">
            {AI_CREDIT_FEATURES.map((id) => {
              const f = features[id];
              const set = (patch: Partial<FeatureRow>) => setFeatures((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
              const ownAllowance = AI_FEATURES_BY_CHARACTER.includes(id);
              const hasLength = AI_FEATURES_WITH_DURATION.includes(id);
              return (
                <div key={id} className="rounded-xl border border-border/60 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <p className="min-w-[8rem] text-sm font-semibold">{AI_FEATURE_LABELS[id]}</p>
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> On</label>
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.payAsYouGo} onChange={(e) => set({ payAsYouGo: e.target.checked })} /> Pay with wallet credits</label>
                    {AI_TIERS.map((t) => (
                      <label key={t} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.tiers[t]} onChange={(e) => set({ tiers: { ...f.tiers, [t]: e.target.checked } })} /> {TIER_LABEL[t]}</label>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <Field id={`f-${id}-mult`} label="Credit multiplier"><input id={`f-${id}-mult`} inputMode="decimal" value={f.multiplier} onChange={(e) => set({ multiplier: e.target.value })} className={small} /></Field>
                    <Field id={`f-${id}-min`} label="Minimum credits"><input id={`f-${id}-min`} inputMode="numeric" value={f.minimum} onChange={(e) => set({ minimum: e.target.value })} className={small} /></Field>
                    {hasLength ? <Field id={`f-${id}-max`} label="Max length (s)"><input id={`f-${id}-max`} inputMode="numeric" value={f.maxSeconds} placeholder="tool's own" onChange={(e) => set({ maxSeconds: e.target.value })} className={small} /></Field> : null}
                    {!ownAllowance ? (
                      AI_TIERS.map((t) => (
                        <Field key={t} id={`f-${id}-inc-${t}`} label={`Included / month · ${TIER_LABEL[t]}`}>
                          <input id={`f-${id}-inc-${t}`} inputMode="numeric" value={f.included[t]} onChange={(e) => set({ included: { ...f.included, [t]: e.target.value } })} className={small} />
                        </Field>
                      ))
                    ) : (
                      <span className="pb-2 text-[11px] text-muted-foreground">Allowance on its own tab.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Group>

        <Group title="Credit packs — what members buy">
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            A pack is that many credits at {symbol}{(payload.credits.centsPerCredit / 100).toFixed(2)} each; a bonus is extra credits on top, recorded as its own statement line. What a payment buys is
            worked out from the amount actually paid — never from what the browser says. The checkout converts to its own currency (Paystack: {cr.recharge.checkoutCurrency}).
          </p>
          <div className="space-y-2">
            {packs.map((p, i) => {
              const set = (patch: Partial<typeof p>) => setPacks((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : patch.highlight ? { ...x, highlight: false } : x)));
              const credits = int(p.credits, 0);
              return (
                <div key={i} className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 px-3 py-2">
                  <Field id={`pack-${i}-credits`} label="Credits"><input id={`pack-${i}-credits`} inputMode="numeric" value={p.credits} onChange={(e) => set({ credits: e.target.value })} className={small} /></Field>
                  <Field id={`pack-${i}-bonus`} label="Bonus credits"><input id={`pack-${i}-bonus`} inputMode="numeric" value={p.bonus} onChange={(e) => set({ bonus: e.target.value })} className={small} /></Field>
                  <span className="pb-2 text-sm tabular-nums text-muted-foreground">= {formatCents(credits * payload.credits.centsPerCredit, symbol)}</span>
                  <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" checked={p.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> On</label>
                  <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="radio" name="pack-highlight" checked={p.highlight} onChange={() => set({ highlight: true })} /> Highlight</label>
                  <button type="button" onClick={() => setPacks((all) => all.filter((_, j) => j !== i))} className="pb-2 text-xs font-semibold text-rose-600">Remove</button>
                </div>
              );
            })}
            {packs.length < WALLET_BOUNDS.packs ? (
              <button type="button" onClick={() => setPacks((all) => [...all, { credits: "", bonus: "0", enabled: true, highlight: false }])} className="rounded-xl border border-dashed border-border px-3 py-2 text-xs font-semibold">
                + Add a pack
              </button>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Toggle label="Custom amount" hint="Members may type a number of credits within the bounds." checked={customEnabled} onChange={setCustomEnabled} />
            <Field id="custom-min" label="Custom minimum (credits)"><input id="custom-min" inputMode="numeric" value={customMin} onChange={(e) => setCustomMin(e.target.value)} className={small} /></Field>
            <Field id="custom-max" label="Custom maximum (credits)"><input id="custom-max" inputMode="numeric" value={customMax} onChange={(e) => setCustomMax(e.target.value)} className={small} /></Field>
          </div>
          <div className="mt-4">
            <div className="mb-3">
              <Toggle
                label="Let members choose Paystack or Bachs"
                hint="On: when a route below has BOTH a primary and a fallback that are set up, the top-up and plan sheets show 'Pay with Paystack / Pay with Bachs' (the primary pre-selected). Off: the route picks silently. Bachs needs BACHS_SECRET_KEY and BACHS_WEBHOOK_SECRET on the server, and for a plan its prod_… id above. To offer Bachs outside Nigeria, set it as the fallback for Other countries."
                checked={memberChoice}
                onChange={setMemberChoice}
              />
            </div>
            <div className="mb-4 rounded-xl border border-border/60 px-3 py-3">
              <Toggle
                label="Members can send credits to each other"
                hint="By 10-digit wallet number, instantly. The sender pays the fee on top; the recipient gets the full amount as AI credits (never withdrawable). Off: nobody can send, history stays visible."
                checked={xfer.enabled}
                onChange={(v) => setXfer({ ...xfer, enabled: v })}
              />
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field id="xfer-fee" label="Fee (%)"><input id="xfer-fee" inputMode="decimal" value={xfer.fee} onChange={(e) => setXfer({ ...xfer, fee: e.target.value })} className={small} /></Field>
                {/* 0202 (owner, 2026-10-09): the fee on the part of a Credits transfer that came from a deposit */}
                <Field id="xfer-depfee" label="Fee on deposited credits (%)"><input id="xfer-depfee" inputMode="decimal" value={xfer.depFee} onChange={(e) => setXfer({ ...xfer, depFee: e.target.value })} className={small} /></Field>
                <Field id="xfer-min" label="Minimum per transfer"><input id="xfer-min" inputMode="numeric" value={xfer.min} onChange={(e) => setXfer({ ...xfer, min: e.target.value })} className={small} /></Field>
                <Field id="xfer-max" label="Maximum per transfer"><input id="xfer-max" inputMode="numeric" value={xfer.max} onChange={(e) => setXfer({ ...xfer, max: e.target.value })} className={small} /></Field>
                <Field id="xfer-daily" label="Most per 24 hours"><input id="xfer-daily" inputMode="numeric" value={xfer.daily} onChange={(e) => setXfer({ ...xfer, daily: e.target.value })} className={small} /></Field>
              </div>
            </div>
            <p className="text-xs font-semibold text-muted-foreground">Payment routing — which provider takes a payment</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              The market is the member&apos;s country as the network edge reports it (never what the browser says). The fallback is used only when the primary is not configured or its checkout could
              not be created — never after a checkout was opened, so nobody pays twice. Payments already started still complete through their own provider.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PAYMENT_MARKETS.flatMap((m) =>
                PAYMENT_PURPOSES.map((pp) => {
                  const r = routing[m][pp];
                  const set = (patch: Partial<typeof r>) => setRouting((all) => ({ ...all, [m]: { ...all[m], [pp]: { ...all[m][pp], ...patch } } }));
                  return (
                    <div key={`${m}-${pp}`} className="rounded-xl border border-border/60 px-3 py-2">
                      <p className="text-xs font-semibold">
                        {m === "NG" ? "Nigeria" : "Other countries"} · {pp === "wallet_topup" ? "Credit top-ups" : pp === "ad_campaign" ? "Ad campaigns" : "AI plans"}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <label className="text-[11px] text-muted-foreground">
                          Primary{" "}
                          <select value={r.primary} onChange={(e) => set({ primary: e.target.value as "paystack" | "bachs" })} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
                            <option value="bachs">Bachs</option>
                            <option value="paystack">Paystack</option>
                          </select>
                        </label>
                        <label className="text-[11px] text-muted-foreground">
                          Fallback{" "}
                          <select value={r.fallback ?? ""} onChange={(e) => set({ fallback: e.target.value === "" ? null : (e.target.value as "paystack" | "bachs") })} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
                            <option value="">None</option>
                            <option value="bachs">Bachs</option>
                            <option value="paystack">Paystack</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        </Group>

        <Group title="Reset">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="reset-tz" label="Time zone the day and week roll over in" hint="Server-side; a member's device clock changes nothing.">
              <input id="reset-tz" list="reset-tz-list" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={input} />
              <datalist id="reset-tz-list">
                {ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
            <Field id="reset-week" label="Week starts on">
              <select id="reset-week" value={weekStartsOn} onChange={(e) => setWeekStartsOn(e.target.value)} className={input}>
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                  <option key={d} value={String(i)}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Group>

        {problems.length ? (
          <ul className="space-y-1 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-xs text-rose-600">
            {problems.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {warnings.length ? (
          <ul className="space-y-1 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void submit()} disabled={busy || problems.length > 0} className={cn("btn-lux bg-foreground text-background", (busy || problems.length > 0) && "opacity-60")}>
            {busy ? "Saving…" : "Save AI plans"}
          </button>
          <span className="text-xs text-muted-foreground">Configuration version {cfg.version}{cfg.updatedAt ? ` · changed ${new Date(cfg.updatedAt).toLocaleString()}` : ""}</span>
          {msg ? <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p> : null}
        </div>
      </div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/40 px-4 py-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label htmlFor={id} className={cn("block", className)}>
      <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/80">{hint}</span> : null}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
