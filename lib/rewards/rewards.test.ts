import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeRewardsConfig, REWARD_EVENTS, REWARDS_DEFAULTS, versionRewardsConfig, withdrawalUsdCents } from "@/lib/rewards/config";

/**
 * Rewards brief part 1 (2026-10-07). The engine is SQL (0187); these pin the
 * rules that move money or could be farmed — each with a case that would fail.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sql = code("supabase/migrations/0187_rewards_referrals.sql");
const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$$;", start));
};

describe("the rules: defaults, bounds, versions", () => {
  it("the brief's defaults: +5 per paid AI video (and to the referrer once), +3 per AI video shared ≥ 30 s; everything else off until the operator sets it", () => {
    expect(REWARDS_DEFAULTS.events.ai_video_completed).toMatchObject({ enabled: true, actorCredits: 5, referrerCredits: 5, referrerRepeatable: false, includeComplimentary: false });
    expect(REWARDS_DEFAULTS.events.ai_video_shared).toMatchObject({ enabled: true, actorCredits: 3, minDurationSeconds: 30 });
    for (const e of REWARD_EVENTS.filter((x) => x !== "ai_video_completed" && x !== "ai_video_shared")) expect(REWARDS_DEFAULTS.events[e].enabled).toBe(false);
    expect(REWARDS_DEFAULTS.qualification).toEqual({ minAccountAgeDays: 30, minEngagements: 100 });
    expect(REWARDS_DEFAULTS.withdrawals.enabled).toBe(false);
  });
  it("🔴 the SQL engine's defaults are the same numbers (reward_default_rule)", () => {
    const d = fn("reward_default_rule");
    expect(d).toMatch(/'ai_video_completed' then '\{"enabled":true,"actorCredits":5,"referrerCredits":5,"referrerRepeatable":false,"includeComplimentary":false/);
    expect(d).toMatch(/'ai_video_shared'\s+then '\{"enabled":true,"actorCredits":3,"referrerCredits":0,"referrerRepeatable":false,"minDurationSeconds":30\}'/);
    expect(d).toContain(`"features":["ai_text_to_video","ai_image_to_video"]`);
    expect(fn("grant_reward")).toContain("'{qualification,minAccountAgeDays}', '')::integer, 30)");
    expect(fn("grant_reward")).toContain("'{qualification,minEngagements}', '')::integer, 100)");
  });
  it("normalises junk and clamps", () => {
    const c = normalizeRewardsConfig({ events: { ai_video_completed: { actorCredits: -4, features: ["ai_text_to_video", "DROP TABLE"] } }, withdrawals: { minCredits: 500, maxCredits: 10 } });
    expect(c.events.ai_video_completed.actorCredits).toBe(0);
    expect(c.events.ai_video_completed.features).toEqual(["ai_text_to_video"]);
    expect(c.withdrawals.maxCredits).toBe(500);
  });
  it("a change of amount bumps the version stamped on later rewards; an unchanged save does not", () => {
    const a = normalizeRewardsConfig(null);
    const b = normalizeRewardsConfig({ events: { ai_video_shared: { actorCredits: 4 } } });
    expect(versionRewardsConfig(a, b).version).toBe(a.version + 1);
    expect(versionRewardsConfig(a, normalizeRewardsConfig(null)).version).toBe(a.version);
  });
  it("a withdrawal never pays a fraction it did not earn", () => {
    expect(withdrawalUsdCents(105, 10)).toBe(1050);
    expect(withdrawalUsdCents(7, 3)).toBe(233);
  });
});

describe("🔴 once means once — the database decides", () => {
  it("one reward per (beneficiary, role, event, dedupe key), and the insert IS the check", () => {
    expect(sql).toContain("create unique index if not exists reward_events_once_uidx on public.reward_events (beneficiary_id, role, event_type, dedupe_key)");
    const g = fn("grant_reward");
    expect(g).toContain("on conflict (beneficiary_id, role, event_type, dedupe_key) do nothing");
    expect(g.indexOf("on conflict (beneficiary_id, role, event_type, dedupe_key) do nothing")).toBeLessThan(g.indexOf("update public.ai_product_balances"));
  });
  it("ONE referred member + ONE event = ONE referrer reward, unless the operator made it repeatable", () => {
    const e = fn("process_reward_event");
    expect(e).toMatch(/when coalesce\(\(v_rule ->> 'referrerRepeatable'\)::boolean, false\) then p_actor::text \|\| ':' \|\| p_source_type \|\| ':' \|\| p_source_id else p_actor::text end/);
  });
  it("an AI generation is rewarded once per JOB, only if it completed with a result, belongs to the actor, is a video feature, and was paid (owner 10-07)", () => {
    const e = fn("process_reward_event");
    expect(e).toContain("v_job.user_id is distinct from p_actor or v_job.status <> 'completed' or v_job.result_path is null");
    expect(e).toContain("not (coalesce(v_rule -> 'features', '[]'::jsonb) ? v_job.feature)");
    expect(e).toContain("v_job.funding_source = 'free' and coalesce((v_rule ->> 'includeComplimentary')::boolean, false) = false");
  });
  it("an AI share is rewarded only for a Frenz AI job, owned, PUBLISHED publicly as an AI reel by its owner, at least the minimum length (measured, not claimed)", () => {
    const e = fn("process_reward_event");
    expect(e).toContain("join public.posts p on p.ai_job_id = j.id");
    expect(e).toContain("j.user_id = p_actor and p.publisher_id = p_actor and j.status = 'completed'");
    expect(e).toContain("coalesce(j.result_duration, 0) >= v_min - 0.05 and p.content_type = 'ai_video' and p.status = 'published' and p.visibility = 'public'");
  });
  it("teeth: the publish route takes NO duration, owner or completion from the browser", () => {
    const r = code("app/api/ai/jobs/[id]/publish/route.ts");
    // only the body schema matters here (the route itself names maxDuration and HTTP statuses)
    const schemaLine = r.split("\n").find((l) => l.startsWith("const schema = ")) ?? "";
    expect(schemaLine).toMatch(/z\.object\(\{ caption: .+, visibility: .+\}\)\.strict\(\)/);
    expect(schemaLine).not.toMatch(/duration|owner|user|status|credits|reward/i);
    const p = code("lib/ai/reels/publish.ts");
    expect(p).toContain("j.user_id !== input.userId");
    expect(p).toContain("durationSec: durationSeconds !== null");
    expect(p).toContain('.update({ content_type: "ai_video", ai_job_id: j.id, format: "reel"');
  });
});

describe("🔴 two classes, decided at the moment, never rewritten", () => {
  const g = fn("grant_reward");
  it("qualification is computed when the reward is granted and written ONCE", () => {
    expect(g).toContain("if v_profile.qualified_at is null then");
    expect(g).toContain("v_class := case when v_profile.qualified_at is not null then 'withdrawable' else 'usable' end;");
    expect(g).toContain("v_profile.qualified_at is not null, v_version");
  });
  it("nothing converts past usable rewards: no statement anywhere moves usable into withdrawable", () => {
    expect(sql).not.toMatch(/update public\.reward_events set credit_class/);
    expect(sql).not.toMatch(/withdrawable_cents\s*=\s*balance_cents/);
  });
  it("spending takes the NON-withdrawable part first (owner 10-07), and a refund returns exactly the part it took", () => {
    expect(fn("reserve_product_charge")).toContain("v_wpart := greatest(0, p_amount - (v_balance - v_wd));");
    expect(fn("refund_product_charge")).toContain("withdrawable_cents = withdrawable_cents + coalesce(v_wpart, 0)");
    expect(fn("adjust_product_balance")).toContain("v_wpart := greatest(0, -p_delta - (v_balance - v_wd));");
  });
  it("a withdrawal can only take withdrawable credits, and a rejection returns them once", () => {
    const r = fn("request_withdrawal");
    expect(r).toContain("if v_wd < p_credits then return jsonb_build_object('ok', false, 'reason', 'insufficient_withdrawable'");
    expect(r).toContain("withdrawable_cents = withdrawable_cents - p_credits");
    const v = fn("resolve_withdrawal");
    expect(v).toContain("'withdrawal_reversal'");
    expect(v).toContain("on conflict (user_id, product, kind, reference) where reference is not null do nothing");
    expect(v).toContain("(v_w.status = 'processing' and p_status in ('completed', 'rejected'))");
  });
  it("the balance can never hold more cashable credit than credit", () => {
    expect(sql).toContain("check (withdrawable_cents >= 0 and withdrawable_cents <= balance_cents)");
  });
});

describe("🔴 attribution — no self, no loop, new accounts only, first touch", () => {
  const a = fn("attribute_referral");
  it("refuses self, a loop, an old account, a second attribution", () => {
    expect(a).toContain("if v_link.owner_id = p_referred then return jsonb_build_object('ok', false, 'reason', 'self')");
    expect(a).toContain("where referred_user_id = v_link.owner_id and referrer_id = p_referred");
    expect(a).toContain("'reason', 'not_new'");
    expect(a).toContain("on conflict (referred_user_id) do nothing");
    expect(sql).toContain("constraint referral_attributions_not_self_chk check (referred_user_id <> referrer_id)");
  });
  it("the click keeps the FIRST token and never uses an IP", () => {
    const r = code("app/r/[token]/route.ts");
    expect(r).toContain("if (!request.headers.get(\"cookie\")?.includes(`${REF_COOKIE}=`))");
    expect(r).toContain("httpOnly: true");
    expect(r).not.toMatch(/x-forwarded-for|ip_hash|cf-connecting-ip/);
  });
  it("a share link is only for content the member owns, with a random token", () => {
    const s = code("lib/referrals/server.ts");
    expect(s).toContain("randomBytes(16).toString(\"base64url\")");
    expect(s).toContain("p.publisher_id !== ownerId");
    expect(s).toContain('if (type === "profile") return contentId === ownerId');
  });
});

describe("🔴 safety", () => {
  it("every reward trigger swallows its own error — a reward never blocks a like, a follow or a job", () => {
    for (const name of ["reward_on_ai_job", "reward_on_activity"]) expect(fn(name)).toMatch(/exception when others then\s+raise warning/);
  });
  it("the definer functions are revoked from the browser roles", () => {
    for (const f of ["process_reward_event(text, uuid, text, text, jsonb)", "grant_reward(uuid, text, text, text, text, uuid, uuid, integer, text, jsonb, jsonb)", "request_withdrawal(uuid, integer, integer, text, jsonb, jsonb, text)", "resolve_withdrawal(uuid, text, uuid, text, text)", "attribute_referral(uuid, text, integer)"]) {
      expect(sql).toContain(`'public.${f}'`);
    }
    expect(sql).toContain("execute format('revoke all on function %s from public, anon, authenticated', fn);");
  });
  it("a restricted member earns nothing and cannot withdraw", () => {
    expect(fn("grant_reward")).toContain("if v_profile.restricted then return null; end if;");
    expect(fn("request_withdrawal")).toContain("'reason', 'restricted'");
  });
  it("a reward push is sent only after the commit, and its failure is swallowed", () => {
    const e = code("lib/rewards/engine.ts");
    expect(e.indexOf('rpc("process_reward_event"')).toBeLessThan(e.indexOf("void pushRewards(granted)"));
    expect(e).toContain('"already-recorded"');
    expect(e).toMatch(/catch \(e\) \{\s+console\.warn\("\[rewards\] push failed \(the reward stands\)"/);
  });
});

describe("🔴 0189 — the engine made cheap, the rules unchanged (performance brief part 2)", () => {
  const perf = code("supabase/migrations/0189_reward_engine_performance.sql");
  const body = (src: string, name: string) => {
    const start = src.indexOf(`create or replace function public.${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("$$;", start));
  };
  const COUNTERS = /\n  -- 0189: running totals[^\n]*\n  update public\.reward_profiles\n[^\n]*\n[^\n]*\n   where user_id = p_beneficiary;\n/;
  const RULES_READ = "  select value -> 'frenzRewards' into v_cfg from public.settings where key = 'landing';";

  it("grant_reward is 0187's, word for word, plus ONLY the running totals", () => {
    const now = body(perf, "grant_reward");
    expect(now).toMatch(COUNTERS);
    expect(now.replace(COUNTERS, "")).toBe(fn("grant_reward"));
  });
  it("process_reward_event is 0187's, word for word, except it reads the small rules row", () => {
    const now = body(perf, "process_reward_event");
    expect(now).not.toContain("from public.settings");
    expect(now).toContain("select rules into v_cfg from public.reward_config where id;");
    const back = now.replace(/  -- 0189: the rules[^\n]*\n  -- [^\n]*\n  select rules into v_cfg from public\.reward_config where id;/, RULES_READ);
    expect(back).toBe(fn("process_reward_event"));
  });
  it("teeth: the comparison sees a changed amount", () => {
    expect(body(perf, "grant_reward").replace(COUNTERS, "").replace("p_amount <= 0", "p_amount < 0")).not.toBe(fn("grant_reward"));
  });
  it("the rules row is kept in step by a trigger on every settings save, and seeded from the live row", () => {
    expect(perf).toContain("create trigger reward_config_sync_trg after insert or update on public.settings");
    expect(perf).toContain("coalesce(new.value -> 'frenzRewards', '{}'::jsonb)");
    expect(perf).toMatch(/insert into public\.reward_config \(id, rules\)\nselect true, coalesce\(\(select value -> 'frenzRewards' from public\.settings where key = 'landing'\)/);
  });
  it("the counters are backfilled once, and the new definer functions are closed to the browser", () => {
    expect(perf).toContain("update public.reward_profiles p\n     set earned_usable = coalesce(t.u, 0), earned_withdrawable = coalesce(t.w, 0)");
    for (const f of ["grant_reward(", "process_reward_event(", "reward_config_sync()", "rewards_admin_totals(timestamptz)"]) expect(perf).toContain(`'public.${f}`);
    expect(perf).toContain("revoke all on public.reward_config from public, anon, authenticated;");
  });
  it("a member's earned totals are the counters, not a scan (the scan survives only as the pre-0189 fallback)", () => {
    const s = code("lib/rewards/summary.ts");
    expect(s).toContain('select("qualified_at, qualifying_engagements, restricted, earned_usable, earned_withdrawable")');
    expect(s.slice(0, s.indexOf("async function legacyProfile"))).not.toContain(".limit(5000)");
  });
  it("the admin tab sums in SQL and reads only bounded lists", () => {
    const a = code("lib/rewards/admin.ts");
    const fast = a.slice(a.indexOf("export async function loadRewardsAdmin"), a.indexOf("async function loadRewardsAdminLegacy"));
    expect(fast).toContain('db.rpc("rewards_admin_totals", { p_since: since })');
    expect(fast).not.toContain("paginatedSelect");
    expect(fast).toContain("if (totals.error || !totals.data) return loadRewardsAdminLegacy();");
  });
  it("an AI reel goes to Stream after the response, like a studio video post", () => {
    const p = code("lib/ai/reels/publish.ts");
    expect(p).toContain("if (hasStream) after(() => ingestReel(published.id, mediaUrl, input.userId));");
    expect(p).toContain('.update({ stream_uid: uid }).eq("id", postId).is("stream_uid", null)');
    expect(p).toContain('cacheControl: "31536000"');
  });
});

describe("the wallet summary reads the AI plan once (performance brief part 2)", () => {
  it("one subscription read, passed to the entitlement and every feature", () => {
    const s = code("lib/ai/wallet/summary.ts");
    expect(s.match(/getAiSubscription\(/g)).toHaveLength(1);
    expect(s).toContain("getAiCreditEntitlement(userId, plans, now, known)");
    expect(s).toContain("featureContext(userId, id, plans, now, known)");
    expect(code("lib/ai/credits/feature-gate.ts")).toContain("known ? known.subscription : await getAiSubscription(userId)");
    expect(code("lib/ai/credits/entitlement.ts")).toContain("known ? known.subscription : await getAiSubscription(userId)");
  });
});
