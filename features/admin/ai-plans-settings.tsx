"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { quoteCharacterReplace } from "@/lib/ai/character-replace/pricing";
import { REPLACEMENT_MODES, replacementModeLabel } from "@/lib/ai/character-replace/modes";
import { AI_PLAN_IDS, AI_PLANS_BOUNDS, normalizeAiPlansConfig, type AiPlanId, type AiPlansConfig } from "@/lib/ai/credits/config";
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
  const [plans, setPlans] = useState<Record<AiPlanId, { enabled: boolean; label: string; price: string; interval: "monthly" | "yearly"; daily: string; weekly: string; code: string; blurb: string }>>({
    ai_pro: { enabled: cfg.plans.ai_pro.enabled, label: cfg.plans.ai_pro.label, price: minorToMajorInput(cfg.plans.ai_pro.priceCents), interval: cfg.plans.ai_pro.interval, daily: String(cfg.plans.ai_pro.dailyCredits), weekly: String(cfg.plans.ai_pro.weeklyCredits), code: cfg.plans.ai_pro.paystackPlanCode, blurb: cfg.plans.ai_pro.blurb },
    ai_max: { enabled: cfg.plans.ai_max.enabled, label: cfg.plans.ai_max.label, price: minorToMajorInput(cfg.plans.ai_max.priceCents), interval: cfg.plans.ai_max.interval, daily: String(cfg.plans.ai_max.dailyCredits), weekly: String(cfg.plans.ai_max.weeklyCredits), code: cfg.plans.ai_max.paystackPlanCode, blurb: cfg.plans.ai_max.blurb },
  });
  const [freeEnabled, setFreeEnabled] = useState(cfg.freeCreations.enabled);
  const [freeCounts, setFreeCounts] = useState({ free: cfg.freeCreations.free === null ? "" : String(cfg.freeCreations.free), pro: cfg.freeCreations.pro === null ? "" : String(cfg.freeCreations.pro), business: cfg.freeCreations.business === null ? "" : String(cfg.freeCreations.business) });
  const [centsPerCredit, setCentsPerCredit] = useState(minorToMajorInput(cfg.credits.centsPerCredit));
  const [minimum, setMinimum] = useState(String(cfg.credits.minimumCredits));
  const [rounding, setRounding] = useState(cfg.credits.rounding);
  const [modeMult, setModeMult] = useState<Record<string, string>>(Object.fromEntries(REPLACEMENT_MODES.map((m) => [m, String(cfg.credits.modeMultiplier[m] ?? 1)])));
  const [qualityMult, setQualityMult] = useState<Record<string, string>>(Object.fromEntries(QUALITY_KEYS.map((q) => [q, String(cfg.credits.qualityMultiplier[q] ?? 1)])));
  const [walletFallback, setWalletFallback] = useState(cfg.walletFallback);
  const [timezone, setTimezone] = useState(cfg.reset.timezone);
  const [weekStartsOn, setWeekStartsOn] = useState(String(cfg.reset.weekStartsOn));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
        featureMultiplier: cfg.credits.featureMultiplier,
      },
      reset: { timezone: timezone.trim() || cfg.reset.timezone, weekStartsOn: int(weekStartsOn, cfg.reset.weekStartsOn) },
      walletFallback,
    }),
    [centsPerCredit, cfg, enabled, freeCounts, freeEnabled, minimum, modeMult, plans, qualityMult, rounding, timezone, walletFallback, weekStartsOn],
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
    for (const id of AI_PLAN_IDS) if (payload.plans[id].enabled && !payload.plans[id].paystackPlanCode) out.push(`${payload.plans[id].label} has no Paystack plan code — it is shown as coming soon and cannot be bought.`);
    if (payload.walletFallback === "allow") out.push("Wallet fallback = allow: a plan member whose allowance is short is charged from their balance without being asked.");
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
                    <Field id={`${id}-code`} label="Paystack plan code" hint="PLN_… from the Paystack dashboard. Empty = coming soon.">
                      <input id={`${id}-code`} value={p.code} onChange={(e) => set({ code: e.target.value })} className={input} placeholder="PLN_…" />
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

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="block">
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
