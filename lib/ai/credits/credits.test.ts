import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_PLANS_BOUNDS, AI_PLANS_DEFAULTS, aiPlanRank, freeCreationsFor, normalizeAiPlansConfig, publicAiPlansConfig, versionAiPlans } from "./config";
import { calculateCredits, remainingAfter } from "./engine";
import { periodKeys } from "./periods";
import { liftAudience } from "../entitlement";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI PRO / AI MAX (2026-09-21, migration 0167) — the engine, the periods,
 *  the configuration, the money order, pinned where a regression would be silent.
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe("the credit engine — one calculator, every tool", () => {
  const cfg = AI_PLANS_DEFAULTS;
  it("converts the priced total at the configured value of a credit, rounding up, never below the minimum", () => {
    // 5 s Full Character 720p at 25¢/s = 125¢ → 12.5 → 13 credits
    const e = calculateCredits({ feature: "ai_character_replace", priceCents: 125, mode: "full_character", quality: "720p", durationMs: 5000 }, cfg);
    expect(e.creditsRequired).toBe(13);
    expect(e.centsPerCredit).toBe(10);
    expect(e.breakdown[0]).toMatchObject({ key: "price", credits: 12.5 });
    expect(e.breakdown[0]!.label).toContain("Full Character");
    expect(e.breakdown[0]!.label).toContain("5-second output");
    // the minimum: a 3¢ price is still one credit
    expect(calculateCredits({ feature: "ai_character_replace", priceCents: 3 }, cfg).creditsRequired).toBe(1);
    // a free (0¢) generation costs no credits
    expect(calculateCredits({ feature: "ai_character_replace", priceCents: 0 }, cfg).creditsRequired).toBe(0);
  });
  it("applies the operator's multipliers and names each one in the breakdown", () => {
    const tilted = normalizeAiPlansConfig({ credits: { centsPerCredit: 10, modeMultiplier: { upper_body: 1.5 }, qualityMultiplier: { "1080p": 2 }, featureMultiplier: { ai_character_replace: 0.5 } } });
    const e = calculateCredits({ feature: "ai_character_replace", priceCents: 1000, mode: "upper_body", quality: "1080p" }, tilted);
    // 100 × 0.5 × 1.5 × 2 = 150
    expect(e.creditsRequired).toBe(150);
    expect(e.breakdown.map((l) => l.key)).toEqual(["price", "feature", "mode", "quality"]);
    expect(e.breakdown.find((l) => l.key === "mode")).toMatchObject({ factor: 1.5, label: "Upper Body adjustment" });
  });
  it("rounds to nearest when configured, and carries the priced lines when given", () => {
    const nearest = normalizeAiPlansConfig({ credits: { rounding: "nearest", centsPerCredit: 10 } });
    expect(calculateCredits({ feature: "x", priceCents: 124 }, nearest).creditsRequired).toBe(12);
    expect(calculateCredits({ feature: "x", priceCents: 125 }, nearest).creditsRequired).toBe(13);
    const withLines = calculateCredits({ feature: "x", priceCents: 150, lines: [{ label: "Video", cents: 100 }, { label: "Voice", cents: 50 }] }, cfg);
    expect(withLines.breakdown.slice(0, 2)).toEqual([
      { key: "price-0", label: "Video", credits: 10, detail: null },
      { key: "price-1", label: "Voice", credits: 5, detail: null },
    ]);
  });
  it("both clocks must cover a generation — the brief's worked example", () => {
    // AI Pro 15/70; #1 costs 8 → 7 / 62 left; #2 costs 7 → 0 / 55; #3 refused by the DAY, the week still has 55
    const a = remainingAfter({ required: 8, dailyLimit: 15, weeklyLimit: 70, usedToday: 0, usedThisWeek: 0 });
    expect(a).toMatchObject({ affordable: true, afterToday: 7, afterThisWeek: 62 });
    const b = remainingAfter({ required: 7, dailyLimit: 15, weeklyLimit: 70, usedToday: 8, usedThisWeek: 8 });
    expect(b).toMatchObject({ affordable: true, afterToday: 0, afterThisWeek: 55 });
    const c = remainingAfter({ required: 1, dailyLimit: 15, weeklyLimit: 70, usedToday: 15, usedThisWeek: 15 });
    expect(c).toMatchObject({ affordable: false, reason: "daily", remainingToday: 0, remainingThisWeek: 55 });
    // the week refuses on its own even with a fresh day
    const d = remainingAfter({ required: 20, dailyLimit: 50, weeklyLimit: 70, usedToday: 0, usedThisWeek: 60 });
    expect(d).toMatchObject({ affordable: false, reason: "weekly", remainingToday: 50, remainingThisWeek: 10 });
  });
});

describe("the periods — the operator's zone, the server's clock", () => {
  it("keys the day in the configured zone, not UTC", () => {
    // 23:30 UTC on the 21st is already the 22nd in Lagos (+1) … and still the 21st in New York
    const t = new Date("2026-09-21T23:30:00Z");
    expect(periodKeys(t, "Africa/Lagos", 1).dayKey).toBe("2026-09-22");
    expect(periodKeys(t, "UTC", 1).dayKey).toBe("2026-09-21");
    expect(periodKeys(t, "America/New_York", 1).dayKey).toBe("2026-09-21");
  });
  it("keys the week by its configured first day, and resets land at the next local midnight", () => {
    const t = new Date("2026-09-23T10:00:00Z"); // a Wednesday
    const mon = periodKeys(t, "UTC", 1);
    expect(mon.weekKey).toBe("2026-09-21");
    expect(mon.dayResetsAt.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(mon.weekResetsAt.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    const sun = periodKeys(t, "UTC", 0);
    expect(sun.weekKey).toBe("2026-09-20");
    expect(sun.weekResetsAt.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    // Lagos midnight is 23:00 UTC the evening before
    expect(periodKeys(t, "Africa/Lagos", 1).dayResetsAt.toISOString()).toBe("2026-09-23T23:00:00.000Z");
  });
  it("survives an unknown zone (UTC) and a DST boundary (New York, 2026-11-01)", () => {
    expect(periodKeys(new Date("2026-09-21T12:00:00Z"), "Not/AZone", 1).timezone).toBe("UTC");
    // the day after the clocks go back is still 24 civil hours long on the key side
    const before = periodKeys(new Date("2026-10-31T16:00:00Z"), "America/New_York", 1);
    expect(before.dayKey).toBe("2026-10-31");
    expect(before.dayResetsAt.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    const after = periodKeys(new Date("2026-11-01T16:00:00Z"), "America/New_York", 1);
    expect(after.dayKey).toBe("2026-11-01");
    expect(after.dayResetsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("the configuration — defaults, bounds, versions", () => {
  it("ships the brief's defaults: AI Pro $10 · 15/70, AI Max $20 · 50/250, 2 one-time creations (the Character Replace count), a 10¢ credit", () => {
    expect(AI_PLANS_DEFAULTS.plans.ai_pro).toMatchObject({ priceCents: 1000, dailyCredits: 15, weeklyCredits: 70, interval: "monthly" });
    expect(AI_PLANS_DEFAULTS.plans.ai_max).toMatchObject({ priceCents: 2000, dailyCredits: 50, weeklyCredits: 250 });
    expect(AI_PLANS_DEFAULTS.freeCreations).toEqual({ enabled: true, free: null, pro: null, business: null });
    expect(freeCreationsFor(AI_PLANS_DEFAULTS, "pro", 2)).toBe(2);
    expect(freeCreationsFor(normalizeAiPlansConfig({ freeCreations: { pro: 5 } }), "pro", 2)).toBe(5);
    expect(freeCreationsFor(normalizeAiPlansConfig({ freeCreations: { pro: 5 } }), "business", 2)).toBe(2);
    expect(freeCreationsFor(normalizeAiPlansConfig({ freeCreations: { enabled: false } }), "free", 2)).toBe(0);
    expect(AI_PLANS_DEFAULTS.credits.centsPerCredit).toBe(10);
    expect(AI_PLANS_DEFAULTS.walletFallback).toBe("ask");
  });
  it("clamps every figure, keeps the week at least a day, drops a bad zone, and never trusts a plan code that is not a token", () => {
    const c = normalizeAiPlansConfig({
      plans: { ai_pro: { dailyCredits: 999_999, weeklyCredits: 1, priceCents: -5, paystackPlanCode: "PLN_abc DEF", interval: "weekly" } },
      credits: { centsPerCredit: 0, minimumCredits: -1, modeMultiplier: { face_only: 99, "bad key!": 2 } },
      reset: { timezone: "Mars/Olympus", weekStartsOn: 9 },
      walletFallback: "maybe",
    });
    expect(c.plans.ai_pro.dailyCredits).toBe(AI_PLANS_BOUNDS.dailyCredits.max);
    expect(c.plans.ai_pro.weeklyCredits).toBe(AI_PLANS_BOUNDS.dailyCredits.max);
    expect(c.plans.ai_pro.priceCents).toBe(0);
    expect(c.plans.ai_pro.paystackPlanCode).toBe("");
    expect(c.plans.ai_pro.interval).toBe("monthly");
    expect(c.credits.centsPerCredit).toBe(1);
    expect(c.credits.minimumCredits).toBe(0);
    expect(c.credits.modeMultiplier.face_only).toBe(AI_PLANS_BOUNDS.multiplier.max);
    expect(c.credits.modeMultiplier["bad key!"]).toBeUndefined();
    expect(c.reset.timezone).toBe("Africa/Lagos");
    expect(c.reset.weekStartsOn).toBe(6);
    expect(c.walletFallback).toBe("ask");
  });
  it("bumps the version only for an entitlement- or cost-bearing change, and the public view never carries a plan code", () => {
    const base = AI_PLANS_DEFAULTS;
    const sameCopy = versionAiPlans(base, normalizeAiPlansConfig({ ...base, plans: { ...base.plans, ai_pro: { ...base.plans.ai_pro, blurb: "new words" } } }));
    expect(sameCopy.version).toBe(base.version);
    const moreCredits = versionAiPlans(base, normalizeAiPlansConfig({ ...base, plans: { ...base.plans, ai_pro: { ...base.plans.ai_pro, dailyCredits: 20 } } }));
    expect(moreCredits.version).toBe(base.version + 1);
    expect(moreCredits.updatedAt).not.toBeNull();
    const withCode = normalizeAiPlansConfig({ plans: { ai_pro: { paystackPlanCode: "PLN_secret123" } } });
    const pub = publicAiPlansConfig(withCode, { code: "USD", symbol: "$" });
    expect(JSON.stringify(pub)).not.toContain("PLN_secret123");
    expect(pub.plans.find((p) => p.id === "ai_pro")?.purchasable).toBe(true);
    expect(pub.plans.find((p) => p.id === "ai_max")?.purchasable).toBe(false);
    expect(aiPlanRank("ai_max")).toBeGreaterThan(aiPlanRank("ai_pro"));
  });
  it("the admin route accepts the key with the same bounds and the settings row versions and audits it", () => {
    const route = src("app/api/admin/landing/route.ts");
    expect(route).toContain("frenzAiPlans: z");
    expect(route).toContain("dailyCredits: z.number().int().min(0).max(100_000)");
    expect(route).toContain("centsPerCredit: z.number().int().min(1).max(1_000_000)");
    const settings = code("lib/landing/settings.ts");
    expect(settings).toContain("frenzAiPlans: versionAiPlans(");
    expect(settings).toContain('surface: "ai_plans"');
  });
});

describe("the entitlement — the two plans lift the AI audience; nothing touches the site plan", () => {
  it("AI Pro reads as at least pro, AI Max as at least business, never below the site plan, never for a guest", () => {
    expect(liftAudience("free", "ai_pro")).toBe("pro");
    expect(liftAudience("free", "ai_max")).toBe("business");
    expect(liftAudience("business", "ai_pro")).toBe("business");
    expect(liftAudience("max_ai", "ai_max")).toBe("max_ai");
    expect(liftAudience("free", null)).toBe("free");
    expect(liftAudience("guest", "ai_max")).toBe("guest");
  });
  it("the site subscription table and its sync are not written by the AI plan path", () => {
    const paystack = code("lib/ai/credits/paystack.ts");
    expect(paystack).not.toContain('from("subscriptions")');
    expect(paystack).not.toContain('from("profiles").update');
    const webhook = code("app/api/paystack/webhook/route.ts");
    const aiBranch = webhook.indexOf("if (await isAiPlanEvent(event.data, plans)) {");
    const siteSync = webhook.indexOf("await syncPaystackEvent(event.event, event.data);");
    expect(aiBranch).toBeGreaterThan(-1);
    expect(aiBranch).toBeLessThan(siteSync);
  });
});

describe("the money order at /start — complimentary → included credits → the wallet", () => {
  const start = code("lib/ai/character-replace/start-job.ts");
  it("decides credits after the complimentary check and before the balance read; reserves after the claim; never reserves money for a credit job", () => {
    const complimentary = start.indexOf("const complimentary = eligibility.eligible && fits?.ok === true");
    const decision = start.indexOf("creditDecision = decideCredits(creditEntitlement,");
    const balanceRead = start.indexOf("const balanceBefore = await getCharacterReplaceBalanceCents(ownerId)");
    const claim = start.indexOf("const claim = await claimJobStart({");
    const reserveCredits = start.indexOf("const reservation = await reserveAiCredits({");
    const reserveMoney = start.indexOf("balanceAfter = await reserveCharacterReplaceCharge({");
    expect(complimentary).toBeGreaterThan(-1);
    expect(decision).toBeGreaterThan(complimentary);
    expect(balanceRead).toBeGreaterThan(decision);
    expect(claim).toBeGreaterThan(balanceRead);
    expect(reserveCredits).toBeGreaterThan(claim);
    expect(reserveMoney).toBeGreaterThan(reserveCredits);
    // the wallet is not asked about when credits cover it; a failed credit reservation reverts the claim
    expect(start).toContain("if (!complimentary && !useCredits && balanceBefore < snapshot.totalCents) {");
    expect(start).toContain('funding: complimentary ? "free" : useCredits ? "credits" : "balance",');
    expect(start).toContain('return refuse("CR_CREDITS_UNAVAILABLE"');
    // the operator's policy for a short allowance
    expect(start).toContain('plans.walletFallback !== "allow"');
    expect(start).toContain('wantsWallet && plans.walletFallback === "off"');
  });
  it("the body may prefer the wallet but can never name an amount, a plan or a balance", () => {
    const schema = src("lib/ai/character-replace/start-schema.ts");
    expect(schema).toContain('funding: z.enum(["credits", "wallet"]).optional()');
    expect(schema).not.toMatch(/credits:\s*z\.number/);
    expect(schema).not.toMatch(/plan:\s*z\.enum\(\["ai_pro"/);
  });
  it("every undo releases credits once through the ledger; completion settles them; both by funding_source", () => {
    expect(code("lib/ai/funding.ts")).toContain('if (opts.job.funding_source === "credits") {');
    expect(code("lib/ai/funding.ts")).toContain("await releaseAiCredits(opts.job.id");
    expect(code("server/services/ai-character-replace-finalize-service.ts")).toContain('job.funding_source === "credits" ? await settleAiCredits(jobId)');
  });
  it("the quote carries the estimate and the policy; the checkout, verify and manage routes decide nothing from the browser", () => {
    const quote = code("app/api/ai/character-replace/quote/route.ts");
    expect(quote).toContain("creditDecisionView(decideCredits(creditEntitlement,");
    expect(quote).toContain("walletFallback: plans.walletFallback");
    const checkout = code("app/api/ai/subscriptions/checkout/route.ts");
    expect(checkout).toContain('plan: z.enum(["ai_pro", "ai_max"])');
    expect(checkout).toContain("planCode: plan.paystackPlanCode");
    expect(checkout).toContain("metadata: { purpose: AI_PLAN_PURPOSE, ai_plan: parsed.data.plan }");
    expect(checkout).not.toMatch(/amount/);
    const verify = code("app/api/ai/subscriptions/verify/route.ts");
    expect(verify).toContain("const charge = await verifyTransaction(reference);");
    expect(verify).toContain("activateAiPlanFromVerifiedCharge(user.id, charge, settings.frenzAiPlans)");
    const activate = code("lib/ai/credits/paystack.ts");
    expect(activate).toContain('if (charge.status !== "success") return { ok: false');
    expect(activate).toContain("if (meta.purpose !== AI_PLAN_PURPOSE) return { ok: false");
    expect(activate).toContain("if (meta.user_id !== userId) return { ok: false");
  });
});

describe("the migration (0167)", () => {
  const sql = src("supabase/migrations/0167_ai_subscriptions_and_credits.sql");
  it("creates the two tables with RLS (select own), the four functions, the third funding source — and the ai_jobs constraint LAST, not valid then validated", () => {
    expect(sql).toContain("create table if not exists public.ai_subscriptions");
    expect(sql).toContain("create table if not exists public.ai_credit_ledger");
    expect(sql).toContain("job_id           uuid not null unique references public.ai_jobs (id) on delete cascade");
    expect(sql).toContain("create policy ai_subscriptions_select_own on public.ai_subscriptions for select using (auth.uid() = user_id)");
    expect(sql).toContain("create policy ai_credit_ledger_select_own on public.ai_credit_ledger for select using (auth.uid() = user_id)");
    for (const fn of ["reserve_ai_credits", "settle_ai_credits", "release_ai_credits", "ai_credit_usage"]) expect(sql).toContain(`create or replace function public.${fn}(`);
    expect(sql).toContain("perform pg_advisory_xact_lock(hashtext('ai_credits:' || p_user_id::text));");
    expect(sql).toContain("if p_funding not in ('balance', 'free', 'credits') then");
    const constraint = sql.indexOf("check (funding_source is null or funding_source in ('free', 'balance', 'credits')) not valid;");
    const validate = sql.indexOf("alter table public.ai_jobs validate constraint ai_jobs_funding_source_chk;");
    const lastFunction = sql.lastIndexOf("create or replace function");
    expect(constraint).toBeGreaterThan(lastFunction);
    expect(validate).toBeGreaterThan(constraint);
  });
  it("a settled row is never released; a replay is idempotent; the complimentary consume takes the operator's current count", () => {
    expect(sql).toContain("where job_id = p_job_id and status = 'reserved';");
    expect(sql).toContain("select * into v_existing from public.ai_credit_ledger where job_id = p_job_id;");
    expect(sql).toContain("drop function if exists public.consume_free_use(uuid, text, uuid, text, text, integer, bigint, text, jsonb);");
    expect(sql).toContain("v_cap := coalesce(p_granted, v_row.granted);");
    expect(sql).toContain("if v_row.eligibility <> 'eligible' or v_row.used >= v_cap then");
  });
  it("every function is revoked from the browser roles", () => {
    for (const fn of [
      "'public.ai_credit_usage(uuid, text, text)'",
      "'public.reserve_ai_credits(uuid, uuid, text, text, integer, integer, integer, text, text, jsonb, jsonb)'",
      "'public.settle_ai_credits(uuid)'",
      "'public.release_ai_credits(uuid, text)'",
    ]) expect(sql).toContain(fn);
    expect(sql).toContain("revoke all on function public.consume_free_use(uuid, text, uuid, text, text, integer, bigint, text, jsonb, integer) from public, anon, authenticated");
  });
  it("the complimentary count read on both routes is the operator's current one, per site plan", () => {
    const free = code("lib/ai/character-replace/free-access.ts");
    expect(free).toContain("const configured = opts.plans ? freeCreationsFor(opts.plans, sitePlan, config.freeAccess.creationsPerAccount) : config.freeAccess.creationsPerAccount;");
    expect(free).toContain("const remaining = Math.max(0, configured - Number(row.used));");
    expect(free).toContain("p_count: configured,");
    expect(free).toContain("p_granted: typeof opts.granted === \"number\" ? opts.granted : null");
    // the cost preview shows no amounts for a complimentary creation
    const preview = src("features/ai/character-replace/video-generation-cost-preview.tsx");
    expect(preview).not.toContain('label="Normal price"');
    expect(preview).toContain('complimentary ? <Row label="Total" value="" amount="Free" strong tone="ok" />');
  });
});

describe("the plan code is a PLN_ code or nothing (2026-09-21)", () => {
  it("a payment-page slug is dropped — the plan reads coming soon instead of failing at Paystack", () => {
    const c = normalizeAiPlansConfig({ plans: { ai_pro: { paystackPlanCode: "kbizwxe4g4" }, ai_max: { paystackPlanCode: "PLN_x1y2z3w4" } } });
    expect(c.plans.ai_pro.paystackPlanCode).toBe("");
    expect(c.plans.ai_max.paystackPlanCode).toBe("PLN_x1y2z3w4");
  });
  it("the checkout route names a plan Paystack does not know and never answers 502 (Cloudflare replaces an origin 502 with its own page)", () => {
    const route = readFileSync(join(process.cwd(), "app/api/ai/subscriptions/checkout/route.ts"), "utf8");
    expect(route).toContain("isPaystackPlanNotFound(e)");
    expect(route).toContain('"PLAN_NOT_CONFIGURED"');
    expect(route).not.toMatch(/status: 502/);
  });
});
