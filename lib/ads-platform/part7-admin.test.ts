import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { actionsFor, FLAG_WORDS, MODERATION_ACTIONS } from "./admin-shared";
import { normalizeBlockedDomain } from "./admin-platform";
import { canTransition, type CampaignStatus } from "./catalog";

/**
 * Ad Platform Part 7 — the admin side. 0204 was executed in PGlite on the real
 * 0195-0198 (20 checks: approve lifts only pending checks, a stale version
 * changes nothing, an admin pause the advertiser cannot lift, a paused campaign
 * failing a check STAYS paused and resumes on its original dates with one slot,
 * reasons required, prorated and full refunds owed, refund decisions once,
 * suspension pauses live ads, service-role grants). Four mutants each failed.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const M = () => code("supabase/migrations/0204_ad_admin_moderation.sql");
const fnBody = (sql: string, name: string) => {
  const s = sql.indexOf(`create or replace function public.${name}(`);
  return s < 0 ? "" : sql.slice(s, sql.indexOf("$$;", s));
};

/** The activation rule 0204 fixes, as a function so a teeth case can run it against a broken copy. */
function pausedStaysPaused(activate: string): boolean {
  return activate.includes("if v_first and c.status <> 'validating' then") && activate.includes("case when v_first then 'validating' else c.status end");
}

describe("🔴 0204 — the admin's decisions are database decisions", () => {
  it("every admin function is service-role only", () => {
    const m = M();
    for (const sig of ["activate_ad_campaign(uuid, uuid, text)", "ad_refund_owed(uuid)", "admin_moderate_ad_campaign(uuid, text, integer, uuid, text)", "admin_set_ad_refund(uuid, text, uuid, text)", "admin_set_advertiser_status(uuid, text, uuid, text)"]) {
      expect(m).toContain(`'public.${sig}'`);
    }
    expect(m).toContain("execute format('revoke all on function %s from public, anon, authenticated', fn);");
  });

  it("a paused campaign that fails a check stays paused (no second slot, no fresh dates)", () => {
    expect(pausedStaysPaused(fnBody(M(), "activate_ad_campaign"))).toBe(true);
  });
  it("teeth: the 0195 rule (paused → validating) fails the pin", () => {
    const broken = fnBody(M(), "activate_ad_campaign").replace("if v_first and c.status <> 'validating' then", "if c.status <> 'validating' then");
    expect(pausedStaysPaused(broken)).toBe(false);
  });

  it("approve only lifts checks that were WAITING; invalid or blocked stay refused", () => {
    const f = fnBody(M(), "admin_moderate_ad_campaign");
    expect(f).toContain("where campaign_id = c.id and status = 'active' and validation_status = 'pending';");
    expect(f).toContain("where campaign_id = c.id and status = 'active' and url_validation_status = 'pending';");
    expect(f).not.toMatch(/validation_status in \([^)]*'invalid'/);
    // activation still goes only through activate_ad_campaign
    expect(f).toContain("r := public.activate_ad_campaign(c.id, p_admin, 'admin');");
    expect(f).not.toMatch(/set status = 'active'/);
  });

  it("an admin pause is Frenzsave's (the advertiser's resume only lifts advertiser_paused)", () => {
    expect(fnBody(M(), "admin_moderate_ad_campaign")).toContain("set status = 'paused', status_reason = 'admin_paused'");
    expect(code("supabase/migrations/0198_ad_platform_dashboard.sql")).toContain("if c.status_reason is distinct from 'advertiser_paused' then return jsonb_build_object('ok', false, 'reason', 'paused_by_frenzsave'); end if;");
  });

  it("reject and remove need a reason and record what is owed back, never more than was paid", () => {
    const f = fnBody(M(), "admin_moderate_ad_campaign");
    expect(f).toContain("if p_action in ('reject', 'remove') and v_why is null then");
    expect(f).toContain("v_owed := case when c.refund_status = 'none' then public.ad_refund_owed(c.id) else 0 end;");
    const owed = fnBody(M(), "ad_refund_owed");
    expect(owed).toContain("if c.started_at is null or c.start_at is null or c.end_at is null then return c.total_amount_minor; end if;");
    expect(owed).toContain("return least(c.total_amount_minor, floor(c.total_amount_minor * v_left / v_total))::bigint;");
  });

  it("suspending an advertiser pauses their live campaigns in the same statement", () => {
    const f = fnBody(M(), "admin_set_advertiser_status");
    expect(f).toContain("update public.ad_campaigns set status = 'paused', status_reason = 'advertiser_' || p_status");
    expect(f).toContain("where advertiser_id = p_advertiser and status = 'active'");
  });

  it("runner laws: no semicolon inside a quoted string, functions and the DO block last", () => {
    const m = M();
    const outsideBodies = m.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
    for (const q of outsideBodies.match(/'[^']*'/g) ?? []) expect(q).not.toContain(";");
    const firstFn = m.indexOf("create or replace function");
    expect(m.slice(firstFn)).not.toMatch(/^\s*(alter table|create index|comment on)/m);
    expect(m.trimEnd().endsWith("end $$;")).toBe(true);
  });
});

describe("the desk offers only moves the database allows", () => {
  const ALL: CampaignStatus[] = ["draft", "awaiting_payment", "payment_processing", "paid", "validating", "active", "paused", "expired", "rejected", "cancelled", "removed"];
  it("every reject/remove/pause offered is a legal transition", () => {
    for (const s of ALL) {
      for (const a of actionsFor(s)) {
        if (a === "reject") expect(canTransition(s, "rejected")).toBe(true);
        if (a === "remove") expect(canTransition(s, "removed")).toBe(true);
        if (a === "pause") expect(canTransition(s, "paused")).toBe(true);
        if (a === "approve") expect(["paid", "validating"]).toContain(s);
        if (a === "resume") expect(s).toBe("paused");
      }
    }
    expect(actionsFor("removed")).toEqual([]);
  });
  it("teeth: offering 'reject' on a live campaign would be caught", () => {
    expect(canTransition("active", "rejected")).toBe(false);
  });
  it("every activation flag has words", () => {
    const activate = fnBody(M(), "activate_ad_campaign");
    const flags = [...activate.matchAll(/v_flags \|\| '([a-z_]+)'::text/g)].map((m) => m[1]!);
    expect(flags.length).toBeGreaterThan(5);
    for (const f of flags) expect(FLAG_WORDS[f], f).toBeTruthy();
    expect(MODERATION_ACTIONS).toEqual(["approve", "reject", "pause", "resume", "remove"]);
  });
});

describe("blocked destinations are bare hosts", () => {
  it("normalizes what an admin pastes", () => {
    expect(normalizeBlockedDomain("https://www.Scam-Site.com/path?x=1")).toBe("scam-site.com");
    expect(normalizeBlockedDomain("sub.example.co.uk")).toBe("sub.example.co.uk");
    expect(normalizeBlockedDomain("example.com:8080")).toBe("example.com");
  });
  it("refuses what the table's check would refuse", () => {
    for (const bad of ["localhost", "", "..com", ".example.com", "exa mple.com", "javascript:alert(1)"]) expect(normalizeBlockedDomain(bad), bad).toBeNull();
  });
});

describe("admin routes and panels", () => {
  const routes = ["app/api/admin/ads/campaigns/route.ts", "app/api/admin/ads/advertisers/route.ts", "app/api/admin/ads/platform/route.ts", "app/api/admin/ads/pricing/route.ts"];
  /** Every exported handler opens with the admin gate. */
  const gated = (src: string) => {
    const handlers = src.split(/export async function (?:GET|POST|PATCH|PUT|DELETE)\(/).slice(1);
    return handlers.length > 0 && handlers.every((h) => /^[^{]*\{\s*const gate = await requireAdminApi\(\);\s*if \(!gate\.ok\) return gate\.response;/.test(h));
  };
  it("every handler is admin-only (404 for anyone else)", () => {
    for (const r of routes) expect(gated(code(r)), r).toBe(true);
  });
  it("teeth: a handler without the gate fails", () => {
    const src = code(routes[0]!).replace("const gate = await requireAdminApi();\n  if (!gate.ok) return gate.response;\n  const p = new URL", "const p = new URL");
    expect(gated(src)).toBe(false);
  });
  it("the two panels upgrade the existing Ads tab, load lazily, and fetch only when shown", () => {
    const page = code("app/admin/page.tsx");
    expect(page).toContain('{ id: "campaigns", label: "Campaigns", content: <AdCampaignsDeskLazy /> },');
    expect(page).toContain('{ id: "self-serve-rules", label: "Self-serve rules", content: <AdPlatformControlsLazy /> },');
    for (const f of ["features/admin/ad-campaigns-desk-lazy.tsx", "features/admin/ad-platform-controls-lazy.tsx"]) expect(code(f)).toContain("ssr: false");
    for (const f of ["features/admin/ad-campaigns-desk.tsx", "features/admin/ad-platform-controls.tsx"]) {
      expect(code(f)).toContain("useShownOnce");
      expect(code(f)).not.toMatch(/setInterval|refetchInterval/);
    }
  });
});
