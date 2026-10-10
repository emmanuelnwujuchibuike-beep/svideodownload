import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AD_EVENT_TYPES, AD_FORMAT_CODES, AD_PLACEMENT_CODES, CAMPAIGN_STATUSES, CAMPAIGN_TRANSITIONS, canTransition, type CampaignStatus } from "./catalog";

/**
 * The TypeScript half and the SQL half of the ad platform must say the same
 * thing. Each list below is parsed OUT OF migration 0195 and compared, so a
 * status, a transition, an event type or a seeded format added on one side
 * only turns this red.
 *
 * The behaviour of the SQL (pricing, the wallet debit, activation, slots,
 * the guard trigger, RLS, grants, dedupe) was EXECUTED against a real
 * Postgres (PGlite) when 0195 was written: 60 checks, and mutants of the
 * guard, the dedupe and the slot cap each turned them red. What can be pinned
 * without a database is pinned here.
 */

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/0195_ad_platform_foundation.sql"), "utf8");
const fn = (name: string) => {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$$;", start));
};
const quoted = (s: string) => [...s.matchAll(/'([a-z_A-Z]+)'/g)].map((m) => m[1]!);

const TABLES = [
  "ad_platform_settings", "ad_formats", "ad_placements", "ad_durations", "ad_pricing_plans", "ad_promotions",
  "advertisers", "ad_campaigns", "ad_creatives", "ad_slots", "ad_campaign_events", "ad_events", "ad_campaign_daily_stats",
];

describe("TS ⇄ SQL: one vocabulary", () => {
  it("campaign statuses", () => {
    const chk = SQL.slice(SQL.indexOf("constraint ad_campaigns_status_chk"), SQL.indexOf("constraint ad_campaigns_name_chk"));
    expect(quoted(chk).sort()).toEqual([...CAMPAIGN_STATUSES].sort());
  });

  it("the transition map, edge for edge", () => {
    const body = fn("ad_campaign_transition_allowed");
    const sqlMap: Record<string, string[]> = {};
    for (const m of body.matchAll(/when '([a-z_]+)'\s+then p_to in \(([^)]*)\)/g)) sqlMap[m[1]!] = quoted(m[2]!).sort();
    const tsMap = Object.fromEntries(Object.entries(CAMPAIGN_TRANSITIONS).filter(([, to]) => to.length > 0).map(([k, v]) => [k, [...v].sort()]));
    expect(sqlMap).toEqual(tsMap);
  });

  it("nothing but activate_ad_campaign can reach active", () => {
    for (const from of CAMPAIGN_STATUSES) expect(canTransition(from, "active" as CampaignStatus), from).toBe(false);
    expect(fn("ad_campaign_transition_allowed")).not.toMatch(/'active'\s*[,)]/);
    // teeth: the parser does see edges
    expect(Object.keys(CAMPAIGN_TRANSITIONS)).toHaveLength(CAMPAIGN_STATUSES.length);
  });

  it("event types (the LATEST constraint and ingest: 0206 added load_failed)", () => {
    const M206 = readFileSync(join(process.cwd(), "supabase/migrations/0206_ad_traffic_quality.sql"), "utf8");
    const chk = M206.slice(M206.indexOf("add constraint ad_events_type_chk"), M206.indexOf("create index if not exists ad_events_campaign_visitor_idx"));
    expect(quoted(chk).sort()).toEqual([...AD_EVENT_TYPES].sort());
    const ingest = M206.slice(M206.indexOf("create or replace function public.track_ad_events("), M206.indexOf("$$;", M206.indexOf("create or replace function public.track_ad_events(")));
    for (const t of AD_EVENT_TYPES) expect(ingest, t).toContain(`'${t}'`);
  });

  it("seeded formats and placements", () => {
    const formats = SQL.slice(SQL.indexOf("insert into public.ad_formats"), SQL.indexOf("insert into public.ad_placements"));
    // 0211 adds the ALL_SLOTS format after 0195's six
    const M211 = readFileSync(join(process.cwd(), "supabase/migrations/0211_ad_all_slots.sql"), "utf8");
    const formats211 = M211.slice(M211.indexOf("insert into public.ad_formats"), M211.indexOf("update public.ad_formats"));
    expect([...formats.matchAll(/\('([A-Z_]+)', '/g), ...formats211.matchAll(/\('([A-Z_]+)', '/g)].map((m) => m[1])).toEqual([...AD_FORMAT_CODES]);
    const placements = SQL.slice(SQL.indexOf("insert into public.ad_placements"), SQL.indexOf("insert into public.ad_durations"));
    // placements seeded after 0195, in migration order: 0203 (HD + batch download rewards), 0207 (history_grid)
    const M203 = readFileSync(join(process.cwd(), "supabase/migrations/0203_download_reward_placements.sql"), "utf8");
    const M207 = readFileSync(join(process.cwd(), "supabase/migrations/0207_ad_history_grid.sql"), "utf8");
    const rows207 = M207.slice(M207.indexOf("insert into public.ad_placements"));
    const rows211 = M211.slice(M211.indexOf("insert into public.ad_placements"));
    const seeded = [...placements.matchAll(/\('([a-z_]+)', '/g), ...M203.matchAll(/\('([a-z_]+)', '/g), ...rows207.matchAll(/\('([a-z_]+)', '/g), ...rows211.matchAll(/\('([a-z_]+)', '/g)].map((m) => m[1]);
    expect(seeded).toEqual([...AD_PLACEMENT_CODES]);
    expect(rows207).toMatch(/\('history_grid', 'History grid', '[^']+', 'CONTENT_BANNER', array\['history'\]/);
    expect(M207).toContain("on conflict (code) do nothing");
  });
});

describe("admin controls the numbers — none is hard-coded", () => {
  it("defaults are seeds the admin edits: 5 s rotation, 10 slots, 15 s reward video", () => {
    expect(SQL).toMatch(/\('TOP_BANNER', 'Top banner', array\['image'\], null, 32, 5, 10,/);
    expect(SQL).toMatch(/\('REWARD_VIDEO', 'Reward video', array\['video'\], null, null, null, 10, true, 15,/);
    expect(SQL).toContain("default_slot_count  integer not null default 10");
  });
  it("no price and no promotion is seeded, and applications start closed", () => {
    expect(SQL).not.toMatch(/insert into public\.ad_pricing_plans/);
    expect(SQL).not.toMatch(/insert into public\.ad_promotions/);
    expect(SQL).toContain("applications_open   boolean not null default false");
  });
  it("no TypeScript in the ad platform carries a price, a campaign length or a promotion", () => {
    const dir = join(process.cwd(), "lib/ads-platform");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.includes(".test."))) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/duration_days\s*[:=]\s*\d|extra_days\s*[:=]\s*\d|price\w*\s*[:=]\s*\d|discount\w*\s*[:=]\s*\d/i);
      expect(src, f).not.toMatch(/maxDurationSeconds\s*[:=]\s*1[05]\b|rotationSeconds\s*[:=]\s*5\b/);
    }
  });
});

describe("money: the database decides, once", () => {
  it("the price comes from enabled admin rows, the discount rounds in the advertiser's favour", () => {
    const q = fn("ad_campaign_quote");
    for (const reason of ["placement_disabled", "format_disabled", "duration_disabled", "no_price"]) expect(q).toContain(`'${reason}'`);
    expect(q).toContain("and currency = p_currency and enabled");
    expect(q).toContain("floor(v_price * v_discount / 100)");
  });
  it("(0195 history, DROPPED by 0197: ads are not paid from credits) wallet payment was row-locked and owner-checked", () => {
    const p = fn("pay_ad_campaign_with_credits");
    expect(p).toContain("for update of c;");
    expect(p).toContain("if not found or v_owner is distinct from p_user then");
    expect(p).toContain("if v_verified is not null then return jsonb_build_object('ok', true, 'already_paid', true");
    expect(p).toContain("v_wpart := greatest(0, v_total - (v_balance - v_wd));");
    expect(p).toContain("v_q := public.ad_campaign_quote(p_campaign, 'CREDIT');");
  });
  it("(0195 history, superseded by 0197 ad_payment_settle) card settle required a SUCCESS attempt and the full amount", () => {
    const s = fn("settle_ad_campaign_payment");
    expect(s).toContain("if v_astatus <> 'success' then");
    expect(s).toContain("if v_cref is distinct from p_reference then");
    expect(s).toContain("v_amount < v_total");
    expect(SQL).toContain("check (purpose in ('wallet_topup', 'ai_subscription', 'ad_campaign'))");
  });
  it("the table refuses an unpaid live campaign and a rewritten payment, whatever the writer", () => {
    expect(SQL).toMatch(/constraint ad_campaigns_paid_chk check \(\s*status in \('draft', 'awaiting_payment', 'payment_processing', 'cancelled', 'removed', 'rejected'\)\s*or payment_verified_at is not null\)/);
    const g = fn("ad_campaigns_guard");
    expect(g).toContain("raise exception 'ad campaign cannot be active without a verified payment'");
    expect(g).toContain("raise exception 'ad campaign payment record is immutable'");
    expect(g).toContain("new.version := old.version + 1;");
  });
  it("activation flags instead of going live, and takes a free slot under a lock", () => {
    const a = fn("activate_ad_campaign");
    for (const flag of ["no_creative", "validation_pending", "creative_invalid", "destination_not_valid", "placement_disabled", "placement_full", "advertiser_not_active"]) {
      expect(a, flag).toContain(`'${flag}'`);
    }
    expect(a).toContain("pg_advisory_xact_lock(hashtext('ad-slots:'");
    expect(a).toContain("if p_actor_role not in ('system', 'admin') then");
  });
  it("concurrent edits: optimistic version check", () => {
    expect(fn("transition_ad_campaign")).toContain("if p_expected_version is not null and v_version <> p_expected_version then");
  });
});

describe("events: once each, through Postgres not Vercel", () => {
  const t = fn("track_ad_events");
  it("dedupe on the browser-minted id, counters bumped only when the row landed", () => {
    expect(t).toContain("on conflict (event_id) do nothing;");
    expect(t).toContain("continue when v_n = 0;");
    expect(t).toContain("jsonb_array_length(p_rows) > 50");
  });
  it("a forged creative/campaign pair counts nothing", () => {
    expect(t).toContain("where cr.id = v_crid and c.id = v_cid");
  });
  it("never raises into the page, and says so in the log", () => {
    expect(t).toContain("raise warning 'track_ad_events row skipped");
  });
});

describe("RLS and grants", () => {
  it("every table has RLS on, and the browser can write none of them", () => {
    for (const t of TABLES) expect(SQL, t).toContain(`alter table public.${t} enable row level security;`);
    const revoke = SQL.slice(SQL.indexOf("revoke insert, update, delete, truncate on"), SQL.indexOf("from anon, authenticated;"));
    for (const t of TABLES) expect(revoke, t).toContain(`public.${t}`);
    expect(SQL).not.toMatch(/create policy [^;]* for (insert|update|delete|all)\b/);
  });
  it("admin checks use the per-statement form, never a per-row call", () => {
    expect(SQL).not.toMatch(/using \(public\.is_admin\(\)\)/);
    expect(SQL.match(/\(select public\.is_admin\(\)\)/g)!.length).toBeGreaterThanOrEqual(9);
  });
  it("every function is revoked from the browser; only the ingest is reopened", () => {
    const fns = [...SQL.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    const grantBlock = SQL.slice(SQL.lastIndexOf("foreach fn in array array["));
    for (const f of fns) expect(grantBlock, f).toContain(`'public.${f}(`);
    expect(grantBlock).toContain("grant execute on function public.track_ad_events(jsonb) to anon, authenticated;");
    expect(grantBlock.match(/to anon/g)).toHaveLength(1);
  });
  it("the public snapshot ships no private column", () => {
    const s = fn("ad_serving_snapshot");
    expect(s).not.toMatch(/contact_email|business_name|total_amount|payment_reference|price|review_flags|status_reason|storage_path/);
  });
});

describe("0196 — the application layer", () => {
  const M = readFileSync(join(process.cwd(), "supabase/migrations/0196_ad_platform_applications.sql"), "utf8");
  it("the catalog is public, the blocklist lookup is server-only", () => {
    expect(M).toContain("grant execute on function public.ad_catalog() to anon, authenticated, service_role;");
    expect(M).toContain("revoke all on function public.ad_domain_blocked(text) from public, anon, authenticated;");
  });
  it("the catalog sells only enabled, priced rows and live promotions", () => {
    const c = M.slice(M.indexOf("create or replace function public.ad_catalog()"));
    expect(c).toContain("from public.ad_formats f where f.enabled");
    expect(c).toContain("where p.enabled and f.enabled");
    expect(c).toContain("from public.ad_durations d where d.enabled");
    expect(c).toMatch(/join public\.ad_placements p on p\.id = pr\.placement_id and p\.enabled[\s\S]*join public\.ad_durations d on d\.id = pr\.duration_id and d\.enabled[\s\S]*where pr\.enabled/);
    expect(c).toContain("where pm.enabled and (pm.starts_at is null or pm.starts_at <= now()) and (pm.ends_at is null or pm.ends_at > now())");
    expect(c).not.toMatch(/advertisers|ad_campaigns|contact_email/);
  });
  it("nothing reaches payment without the rules on record", () => {
    expect(M).toMatch(/constraint ad_campaigns_rules_chk check \(\s*status in \('draft', 'cancelled', 'removed', 'rejected'\)\s*or \(rules_accepted_at is not null and rules_version is not null\)\);/);
  });
  it("uploads land in a PRIVATE staging bucket", () => {
    expect(M).toMatch(/values \('ad-creatives-staging', 'ad-creatives-staging', false,/);
    expect(M).toContain("set public = false");
  });
  it("an admin's own wording is never overwritten (coalesce, and placement copy only over the untouched seed)", () => {
    expect(M).toContain("description = coalesce(description,");
    expect(M).toMatch(/where code = 'global_top_banner' and description = 'The 32 px strip at the top of every page\.'/);
  });
});
