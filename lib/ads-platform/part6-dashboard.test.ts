import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { byCampaign, byDay, remaining, statusLabel, totalsOf, type StatRow } from "@/features/ads-platform/dashboard/dashboard-data";

import { DEFAULT_CONTROLS, parseControls } from "./campaign-manage";

/**
 * Ad Platform Part 6 — the advertiser dashboard (docs/AD_PLATFORM_PART6_BRIEF.md §15).
 *
 * The SQL in 0198 was EXECUTED against a real Postgres (PGlite) with the real
 * 0151/0186/0188/0195–0198 migrations: 48 checks (live swap, refused swap,
 * IDOR, stale version, blocked creative, pause/resume incl. an admin pause,
 * extension quote → begin → short payment → settle → duplicate webhook,
 * expired campaign, owner-scoped summary/payments, grants), and two mutants
 * (no validation check on swap; no owner check) each turned it red. The
 * harness is not committed (as in Parts 1–3); these tests pin the contract.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const M198 = () => src("supabase/migrations/0198_ad_platform_dashboard.sql");
const fn = (name: string) => {
  const s = M198();
  const i = s.indexOf(`create or replace function public.${name}(`);
  return s.slice(i, s.indexOf("\n$$;", i));
};

const row = (o: Partial<StatRow>): StatRow => ({ campaign_id: "c1", creative_id: "cr1", day: "2026-10-01", impressions: 0, clicks: 0, video_starts: 0, video_completes: 0, reward_starts: 0, reward_completes: 0, ...o });

describe("§15.1 / §13 — advertisers see only their own", () => {
  it("dashboard reads go through the member's own session (RLS), never the service role", () => {
    const d = src("features/ads-platform/dashboard/dashboard-data.ts");
    expect(d).toContain('import { getClient } from "@/lib/supabase/client-lazy";');
    expect(d).not.toMatch(/createAdminClient|service_role/);
  });

  it("summary and payments are owner-scoped by auth.uid() and readable only by signed-in members", () => {
    expect(fn("ad_my_summary")).toContain("where a.user_id = auth.uid()");
    expect(fn("ad_my_payments")).toContain("where t.user_id = auth.uid() and t.purpose = 'ad_campaign'");
    expect(M198()).toContain("execute format('revoke all on function %s from public, anon', fn);");
  });

  it("every write re-checks ownership under a row lock and answers not_found to a stranger", () => {
    for (const f of ["ad_swap_creative", "ad_edit_creative_details", "ad_advertiser_pause", "ad_extension_quote"]) {
      const b = fn(f);
      expect(b, f).toContain("for update of ca");
      expect(b, f).toContain("if not found or c.owner_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;");
    }
    // and the write functions are not callable from the browser at all
    expect(M198()).toContain("execute format('revoke all on function %s from public, anon, authenticated', fn);");
  });

  it("the route never says 'exists but not yours'", () => {
    expect(src("lib/ads-platform/campaign-manage.ts")).toContain('if (!row || adv?.user_id !== userId) return refuse("not_found", 404);');
  });
});

describe("§15.2/3/6 — live creative replacement", () => {
  it("a replacement is staged; nothing serves a staged creative", () => {
    expect(M198()).toContain("check (status in ('active', 'paused', 'removed', 'staged'))");
    expect(src("supabase/migrations/0195_ad_platform_foundation.sql")).toContain("from public.ad_creatives cr where cr.campaign_id = c.id and cr.status = 'active'");
    expect(src("lib/ads-platform/campaign-manage.ts")).toContain('{ status: "staged", destination_url: cur!.destination_url!, headline: cur!.headline, description: cur!.description }');
  });

  it("the swap is one transaction, only for a VALID staged creative, and keeps the old one for audit", () => {
    const s = fn("ad_swap_creative");
    expect(s).toContain("if n.status <> 'staged' or n.validation_status <> 'valid' or n.url_validation_status <> 'valid' then");
    expect(s).toContain("update public.ad_creatives set status = 'removed', updated_at = now()");
    expect(s).toContain("'creative_replaced'");
    expect(s).not.toMatch(/insert into public\.ad_campaigns|insert into public\.ai_topup_attempts|ad_slots/);
  });

  it("a failed replacement leaves the live creative untouched (probeAndPublish never touches other creatives)", () => {
    const a = src("lib/ads-platform/advertiser-server.ts");
    const p = a.slice(a.indexOf("export async function probeAndPublish"), a.indexOf("/* ─────────────────────────────────── submit"));
    expect(p).not.toMatch(/neq\("id", cr\.id\)/);
    const m = src("lib/ads-platform/campaign-manage.ts");
    expect(m).toContain('if (!result.ok) {\n    await notifyAdvertiser(db, c.id, { kind: "creative_rejected" });\n    return { ...result, swapped: false };');
  });

  it("concurrent edits are refused, not overwritten (expected version)", () => {
    for (const f of ["ad_swap_creative", "ad_edit_creative_details", "ad_advertiser_pause"]) {
      expect(fn(f), f).toContain("if p_expected_version is not null and c.version <> p_expected_version then");
    }
  });
});

describe("§15.4/5 — uploads and links are checked by the server", () => {
  it("the replacement's bytes go through the same probe as a new ad", () => {
    // 0208: a replacement takes the synchronous path (it swaps into a running ad)
    expect(src("lib/ads-platform/campaign-manage.ts")).toContain('const result = await probeAndPublish(db, { id: cr.id as string, storage_path: cr.storage_path as string }, f, "replacement");');
  });

  it("a new link gets the full check (Part 8: safety, blocklist, reputation, redirects) before the database applies it", () => {
    const m = src("lib/ads-platform/campaign-manage.ts");
    expect(m).toContain("const verdict = await checkDestination(db, destination, { deep: true });");
    expect(m).toContain('if (verdict.status === "pending") refuse("needs_review", 409');
    expect(m).toContain('if (verdict.status === "blocked") refuse(');
  });

  it("blocked campaigns cannot edit their way out", () => {
    for (const f of ["ad_swap_creative", "ad_edit_creative_details", "ad_extension_quote"]) {
      expect(fn(f), f).toContain("validation_status = 'blocked'");
    }
  });
});

describe("§15.7/8/9/10 — money", () => {
  it("ordinary edits never touch a payment", () => {
    for (const f of ["ad_swap_creative", "ad_edit_creative_details"]) expect(fn(f), f).not.toMatch(/ai_topup_attempts|ad_payment_quotes|total_amount_minor/);
  });

  it("an extension is priced by the database from admin rows, through the one price rule", () => {
    expect(fn("ad_extension_quote")).toContain("v_p := public.ad_price_for(c.placement_id, p_duration, 'USD');");
    expect(fn("ad_campaign_quote")).toContain("return public.ad_price_for(v_placement, v_duration, p_currency);");
  });

  it("an extension keeps the campaign id and start; it moves only the end, once, after verified payment", () => {
    const a = fn("ad_apply_extension");
    expect(a).toContain("if e.status = 'applied' then return jsonb_build_object('ok', true, 'already', true");
    expect(a).toContain("update public.ad_campaigns set end_at = v_new where id = c.id;");
    expect(a).not.toMatch(/start_at|insert into public\.ad_campaigns/);
    const s = fn("ad_payment_settle");
    expect(s).toContain("return jsonb_build_object('ok', true, 'extension', public.ad_apply_extension(p_reference));");
    expect(s).toContain("return jsonb_build_object('ok', true, 'already', true, 'extension', true);");
  });

  it("the extension rides the SAME checkout, providers and ledger — no second payment system", () => {
    expect(fn("ad_payment_begin")).toContain("if v_q.kind = 'extension' then");
    expect(src("app/api/ads/payment/create/route.ts")).toContain("extension: body.extension === true,");
    expect(src("lib/ads-platform/payment-server.ts")).toContain("const applicationId = input.extension ? (head.id as string)");
  });

  it("a payment that arrives after the campaign stopped is held for a person, not lost or applied", () => {
    expect(fn("ad_apply_extension")).toContain("update public.ad_campaign_extensions set status = 'held'");
  });
});

describe("§15.11 / §11 — controls cannot bypass eligibility", () => {
  it("resume re-runs every activation check; an admin pause is not the advertiser's to lift", () => {
    const p = fn("ad_advertiser_pause");
    expect(p).toContain("if c.status_reason is distinct from 'advertiser_paused' then return jsonb_build_object('ok', false, 'reason', 'paused_by_frenzsave'); end if;");
    expect(p).toContain("r := public.activate_ad_campaign(p_campaign, p_user, 'system');");
  });

  it("expired campaigns can't be edited or extended", () => {
    expect(fn("ad_edit_creative_details")).toContain("if c.end_at is not null and c.end_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;");
    expect(fn("ad_extension_quote")).toContain("c.end_at <= now() then\n    return jsonb_build_object('ok', false, 'reason', 'not_extendable'");
  });

  it("the admin decides what advertisers may do; defaults allow all, junk falls back to defaults", () => {
    expect(parseControls(null)).toEqual(DEFAULT_CONTROLS);
    expect(parseControls({ pauseResume: false, extensions: "yes" })).toEqual({ ...DEFAULT_CONTROLS, pauseResume: false });
  });
});

describe("§15.12/13 — analytics", () => {
  it("totals come from the daily aggregate, never raw events; CTR is clicks ÷ views", () => {
    const rows = [row({ impressions: 100, clicks: 4 }), row({ day: "2026-10-02", impressions: 50, clicks: 1 }), row({ campaign_id: "c2", impressions: 10, clicks: 0 })];
    expect(totalsOf(rows)).toMatchObject({ views: 160, clicks: 5 });
    expect(totalsOf(rows).ctr).toBeCloseTo(5 / 160);
    expect(totalsOf([]).ctr).toBeNull();
    expect(byCampaign(rows).get("c1")).toMatchObject({ views: 150, clicks: 5 });
    expect(byDay(rows)).toEqual([{ day: "2026-10-01", views: 110, clicks: 4 }, { day: "2026-10-02", views: 50, clicks: 1 }]);
    expect(src("features/ads-platform/dashboard/dashboard-data.ts")).not.toMatch(/from\("ad_events"\)/);
  });

  it("figures are shown as the database counts them - the only scaling is the labelled admin sample-data mode (0211)", () => {
    const d = src("features/ads-platform/dashboard/dashboard-data.ts");
    // no ad-hoc factors or inflation: a scale may only come from an admin-set stats_multiplier
    expect(d).not.toMatch(/\* *factor|inflat/i);
    expect(d.replace(/stats_multiplier/g, "")).not.toMatch(/multiplier/i);
    // test mode is never silent: the dashboards render the note whenever a campaign is boosted
    expect(src("features/ads-platform/dashboard/campaign-detail.tsx")).toContain("TestModeNote");
    expect(src("features/ads-platform/my-campaigns.tsx")).toContain("TestModeNote");
    expect(src("features/ads-platform/dashboard/test-mode-note.tsx")).toMatch(/Sample data/);
    // display only: the stored aggregates, billing and the 0211 migration never rewrite them
    const m = src("supabase/migrations/0212_ad_stats_test_boost.sql");
    expect(m).not.toMatch(/update\s+public\.ad_campaign_daily_stats|update\s+public\.ad_events|insert\s+into\s+public\.ad_campaign_daily_stats/i);
    expect(m).toMatch(/stats_multiplier in \(1, 10\)/);
    // a boost can only be set through the admin-only, service-role function
    expect(m).toMatch(/revoke all on function public\.admin_set_ad_stats_boost\(uuid, integer, uuid\) from public, anon, authenticated/);
  });

  it("a preview records nothing: no ad renderer, no event client on the dashboard", () => {
    for (const f of ["features/ads-platform/dashboard/campaign-detail.tsx", "features/ads-platform/my-campaigns.tsx"]) {
      const c = src(f);
      expect(c, f).not.toMatch(/SelfAdCreative|ad-events-client|trackAdEvent|observeImpression/);
    }
  });
});

describe("§14 — cost", () => {
  it("the dashboard page is static; a campaign opens in place, never on a server-rendered route", () => {
    expect(src("app/(marketing)/advertise/campaigns/page.tsx")).toContain('export const dynamic = "force-static";');
    expect(src("lib/ads-platform/ad-notify.ts")).toContain("/advertise/campaigns?c=${campaignId}");
  });

  it("no polling, no Realtime on the dashboard; search waits for a pause in typing; lists are paginated", () => {
    for (const f of ["features/ads-platform/my-campaigns.tsx", "features/ads-platform/dashboard/campaign-detail.tsx", "features/ads-platform/dashboard/dashboard-data.ts"]) {
      const c = src(f);
      expect(c, f).not.toMatch(/setInterval\s*\(|\.channel\s*\(|postgres_changes/);
    }
    expect(src("features/ads-platform/my-campaigns.tsx")).toContain("}, 350);");
    expect(src("features/ads-platform/dashboard/dashboard-data.ts")).toContain("q.range(from, from + PAGE_SIZE - 1)");
  });
});

describe("§12 — notifications: push + in-app + email, never able to break money", () => {
  it("each channel is guarded on its own and the whole is best-effort", () => {
    const n = src("lib/ads-platform/ad-notify.ts");
    expect(n).toContain(".catch((e: unknown) => console.warn(\"[ads-platform] advertiser push failed\"");
    expect(n).toContain("await sendProductEmail(to, { subject: w.title, heading: esc(w.title), intro: esc(w.body)");
    expect(n).toContain("} catch (e) {\n    console.warn(\"[ads-platform] advertiser notification failed\"");
  });

  it("the advertiser's own text is escaped before it goes into the email HTML", () => {
    const n = src("lib/ads-platform/ad-notify.ts");
    expect(n).toContain("function esc(v: string): string {");
  });
});

describe("display", () => {
  it("statuses come from the server's status", () => {
    const base = { status_reason: null, start_at: null, end_at: null, ad_creatives: [] };
    expect(statusLabel({ ...base, status: "active" }).text).toBe("Live");
    expect(statusLabel({ ...base, status: "paused", status_reason: "advertiser_paused" }).text).toBe("Paused");
    expect(statusLabel({ ...base, status: "paused", status_reason: "policy" }).text).toBe("Paused by Frenzsave");
    expect(statusLabel({ ...base, status: "active", start_at: new Date(Date.now() + 86_400_000).toISOString() }).text).toBe("Scheduled");
    expect(statusLabel({ ...base, status: "active", ad_creatives: [{ status: "staged", validation_status: "pending" } as never] }).text).toBe("Live · update checking");
    expect(statusLabel({ ...base, status: "active", ad_creatives: [{ status: "active", validation_status: "blocked" } as never] }).text).toBe("Blocked");
  });

  it("time left", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    expect(remaining("2026-10-10T12:00:00Z", now)).toBe("2 days left");
    expect(remaining("2026-10-08T15:00:00Z", now)).toBe("3 hours left");
    expect(remaining("2026-10-08T11:00:00Z", now)).toBe("Ended");
  });
});

describe("2026-10-09: the admin campaign list survives a database that has not run 0212 yet", () => {
  it("never names stats_multiplier in its select (it would fail the whole list)", () => {
    const a = src("lib/ads-platform/admin-campaigns.ts");
    expect(a).toContain('.select("*, advertisers(id, business_name, status), ad_placements(code, name, format_code)")');
    expect(a).toContain("statsMultiplier: Number(c.stats_multiplier ?? 1),");
  });
});
