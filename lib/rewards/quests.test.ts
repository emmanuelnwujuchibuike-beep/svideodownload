import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planCreditsPrice } from "@/lib/ai/credits/config";
import { subscriptionIsActive } from "@/lib/ai/credits/subscription";
import { normalizeRewardsConfig } from "@/lib/rewards/config";
import { buildQuestBoard, normalizeQuests, QUESTS_DEFAULTS } from "@/lib/rewards/quests";

/**
 * Owner, 2026-10-07: daily (01:00 Lagos) and weekly (Sunday 01:00 Lagos) quests
 * the admin sets, different rewards per quest, a weekly limit — and credits can
 * pay for an AI plan. Pinned where a regression would pay twice, pay without
 * the operator switching it on, or let a plan outlive what was paid.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const m92 = code("supabase/migrations/0194_quests.sql");
const body = (src: string, name: string) => {
  const start = src.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("$$;", start));
};

describe("quests are the operator's, and ship switched off", () => {
  it("off by default — no credits are paid until the admin turns them on", () => {
    expect(QUESTS_DEFAULTS.enabled).toBe(false);
    expect(normalizeRewardsConfig({}).quests.enabled).toBe(false);
    expect(body(m92, "quest_record")).toContain("if coalesce((v_quests ->> 'enabled')::boolean, false) = false then return; end if;");
  });
  it("normalises junk: unknown events dropped, ids made safe, numbers clamped, duplicates removed", () => {
    const q = normalizeQuests({ enabled: true, weeklyCreditCap: -5, items: [
      { title: "Save 3 videos!", event: "download_completed", target: 0, credits: 99_999, period: "daily" },
      { title: "Hack", event: "wallet_topup", target: 1, credits: 1, period: "daily" },
      { id: "save-3-videos", title: "dupe", event: "download_completed", target: 1, credits: 1, period: "weekly" },
    ] });
    expect(q.weeklyCreditCap).toBe(0);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ id: "save-3-videos", target: 1, credits: 10_000, period: "daily" });
  });
  it("the board shows this period's progress only, capped at the target", () => {
    const cfg = normalizeQuests({ enabled: true, items: [
      { id: "d", title: "Daily", event: "download_completed", target: 3, credits: 1, period: "daily" },
      { id: "w", title: "Weekly", event: "follow", target: 2, credits: 5, period: "weekly" },
    ] });
    const b = buildQuestBoard(cfg, {
      periods: { day: "D2026-10-07", week: "W2026-10-04", dayEndsAt: "2026-10-08T00:00:00Z", weekEndsAt: "2026-10-11T00:00:00Z" },
      progress: [
        { quest: "d", period: "D2026-10-06", progress: 9, completedAt: "x" }, // yesterday — ignored
        { quest: "d", period: "D2026-10-07", progress: 2, completedAt: null },
        { quest: "w", period: "W2026-10-04", progress: 5, completedAt: "2026-10-05" },
      ],
      weekEarned: 5,
    });
    expect(b.daily[0]).toMatchObject({ progress: 2, completed: false });
    expect(b.weekly[0]).toMatchObject({ progress: 2, completed: true });
  });
});

describe("🔴 quests pay once — per source, per quest, per period — under the weekly cap", () => {
  const rec = body(m92, "quest_record");
  it("an activity counts once per source, ever (like → unlike → like does not count twice)", () => {
    expect(rec).toContain("insert into public.quest_event_log (user_id, event_type, source_key)");
    expect(rec).toContain("get diagnostics v_target = row_count;\n  if v_target = 0 then return; end if;");
  });
  it("a quest pays once per period: the engine's once-only key carries quest and period", () => {
    expect(rec).toContain("'quest:' || (v_q ->> 'id') || ':' || v_period");
    expect(rec).toContain("if v_progress >= v_target and v_done is null then");
  });
  it("the weekly cap trims the reward to what is left this week", () => {
    expect(rec).toContain("v_credits := least(v_credits, greatest(0, v_cap - v_earned)::integer);");
  });
  it("an AI event counts only when the job really completed for this member", () => {
    expect(rec).toContain("perform 1 from public.ai_jobs where id = p_source_id::uuid and user_id = p_actor and status = 'completed';");
  });
  it("periods are Lagos time minus one hour — days turn at 01:00, weeks at Sunday 01:00", () => {
    const p = body(m92, "quest_periods");
    expect(p).toContain("(p_at at time zone 'Africa/Lagos') - interval '1 hour'");
    expect(p).toContain("extract(dow from t.l)");
  });
  it("process_reward_event is 0189's plus ONLY the quest hook, which can never block a reward", () => {
    const now = body(m92, "process_reward_event");
    const hook = now.slice(now.indexOf("  -- 0192: quests count"), now.indexOf("  end;\n", now.indexOf("  -- 0192: quests count")) + "  end;\n".length);
    expect(hook).toContain("exception when others then");
    expect(now.replace(hook, "")).toBe(body(code("supabase/migrations/0189_reward_engine_performance.sql"), "process_reward_event"));
  });
});

describe("🔴 an AI plan paid with credits", () => {
  const buy = body(m92, "buy_ai_plan_with_credits");
  it("one transaction: lock, refuse the same or a higher live plan, refuse a short balance", () => {
    expect(buy).toContain("perform pg_advisory_xact_lock(hashtext('ai-plan-credits:' || p_user::text));");
    expect(buy).toContain("return jsonb_build_object('ok', false, 'reason', 'already_on_plan');");
    expect(buy).toContain("if v_balance < p_credits then return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', v_balance); end if;");
  });
  it("spends the non-withdrawable part first, like every charge, and never renews", () => {
    expect(buy).toContain("v_wpart := greatest(0, p_credits - (v_balance - v_wd));");
    expect(buy).toContain("cancel_at_period_end = true");
  });
  it("the price is the plan's, rounded up — never the browser's", () => {
    const r = code("app/api/ai/subscriptions/credits/route.ts");
    expect(r).toContain("const schema = z.object({ plan: z.enum([\"ai_pro\", \"ai_max\"]) }).strict();");
    expect(r).toContain("const credits = planCreditsPrice(plan, plans.credits.centsPerCredit);");
  });
  it("the admin's own credit price wins; without one, the plan price at the credit rate, rounded up", () => {
    expect(planCreditsPrice({ priceCents: 1000, creditsPrice: 0 }, 10)).toBe(100);
    expect(planCreditsPrice({ priceCents: 1001, creditsPrice: 0 }, 10)).toBe(101);
    expect(planCreditsPrice({ priceCents: 1000, creditsPrice: 60 }, 10)).toBe(60);
  });
  it("teeth: a credits plan ends AT its period end (no renewal grace); a card plan keeps its grace", () => {
    const end = "2026-11-07T00:00:00Z";
    const dayAfter = Date.parse(end) + 86_400_000;
    expect(subscriptionIsActive({ status: "active", current_period_end: end, provider: "credits" }, dayAfter)).toBe(false);
    expect(subscriptionIsActive({ status: "active", current_period_end: end, provider: "paystack" }, dayAfter)).toBe(true);
  });
});

describe("the quest page never reloads for nothing", () => {
  const page = code("features/quests/quests-page.tsx");
  it("paints the kept board, asks again only when stale or a period ended, and changes the screen only on a real difference", () => {
    expect(page).toContain("if (!force && cached && Date.now() - cached.at < STALE_MS && !periodOver) return;");
    expect(page).toContain("if (!cached || JSON.stringify(cached.board) !== JSON.stringify(next)) setBoard(next);");
  });
  it("an Earn button sits on every AI page's credit strip", () => {
    const strip = code("features/ai/design/ai-credit-strip.tsx");
    // a link that goes ONCE — the double tap opened a second quest page (owner, 2026-10-07)
    expect(strip).toContain('<TapOnceLink href="/quests" aria-label="Earn credits"');
    expect(strip).not.toContain("Trophy");
    const once = code("features/ui/tap-once-link.tsx");
    expect(once).toContain("if (pending.current) {\n          e.preventDefault();");
  });
});
