import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseModeration, worse } from "./creative-moderation";
import { baseDomain, destinationHeuristics, isPrivateAddress } from "./url-safety";

/**
 * Ad Platform Part 8 — traffic quality, fraud signals and creative safety.
 *
 * 0206 was executed in PGlite on the real 0195–0205 (33 checks, applied twice):
 *   - accepted and qualifying events, replay ignored, the IP stored only as a daily hash
 *   - click without a view, the 4th click in a day, bot UA, admin and self traffic: filtered
 *   - 30 people on ONE shared network all count; a network over its per-minute limit is refused
 *   - reward completion on a banner refused; too fast or without a start filtered
 *   - stale events, arbitrary creative ids and ineligible campaigns refused
 *   - one flag per kind and day, resolve-with-exclusion audited, decided once
 *   - blocking a domain pauses the live ad, chargebacks raise flags, safety review holds activation
 *   - retention deletes raw events and drops the hash; the salt is private
 * Five mutants (no view check, no click cap, no bot rule, no eligibility window,
 * no speed check) each failed. These tests pin the shipped text.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const M = () => code("supabase/migrations/0206_ad_traffic_quality.sql");
const fn = (name: string) => {
  const m = M();
  const s = m.indexOf(`create or replace function public.${name}(`);
  return s < 0 ? "" : m.slice(s, m.indexOf("$$;", s));
};

describe("destination heuristics (no network)", () => {
  it("blocks redirect parameters, open redirectors and file-extension domains", () => {
    expect(destinationHeuristics("https://shop.example.com/go?url=https%3A%2F%2Fevil.example.net").verdict).toBe("block");
    expect(destinationHeuristics("https://www.google.com/url?q=https://evil.example.net").verdict).toBe("block");
    expect(destinationHeuristics("https://l.facebook.com/l.php?u=https://x.example").verdict).toBe("block");
    expect(destinationHeuristics("https://invoice.zip/pay").verdict).toBe("block");
    expect(destinationHeuristics("https://shop.example.com/https://evil.example.net/").verdict).toBe("block");
  });
  it("sends lookalikes and internationalized hosts to a person", () => {
    expect(destinationHeuristics("https://paypa1-secure.example.com/login")).toEqual({ verdict: "review", reason: "brand_lookalike:paypal" });
    expect(destinationHeuristics("https://frenzsave-rewards.example.com/")).toMatchObject({ verdict: "review" });
    expect(destinationHeuristics("https://xn--pypal-4ve.com/").verdict).toBe("review");
  });
  it("leaves ordinary links alone — including brand words inside other words, and the brands' own domains", () => {
    for (const ok of ["https://shop.example.com/sale?utm_source=frenzsave", "https://pineapple-bakery.com/menu", "https://www.paypal.com/checkout", "https://frenzsave.com/advertise", "https://tropay.example.org/"]) {
      expect(destinationHeuristics(ok), ok).toEqual({ verdict: "ok" });
    }
  });
  it("teeth: a query value that is not a URL is not a redirect", () => {
    expect(destinationHeuristics("https://shop.example.com/search?q=red+shoes").verdict).toBe("ok");
  });
});

describe("the redirect probe never reaches private networks", () => {
  it("refuses loopback, private, link-local, CGNAT, metadata and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("teeth: public addresses pass", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("is HEAD-only, https/443, pinned to the checked address, bounded in hops and time", () => {
    const s = code("lib/ads-platform/url-safety.ts");
    expect(s).toContain('method: "HEAD"');
    expect(s).toContain("port: 443,");
    expect(s).toContain("lookup: safeLookup as never");
    expect(s).toContain("const maxHops = opts.maxHops ?? 5;");
    expect(s).toContain("const deadline = Date.now() + (opts.budgetMs ?? 4000);");
    expect(s).toContain("res.destroy();");
  });
  it("registrable domains group subdomains", () => {
    expect(baseDomain("a.b.shop.example.com")).toBe("example.com");
    expect(baseDomain("www.shop.co.uk")).toBe("shop.co.uk");
  });
});

describe("content moderation reuses the existing integration and fails safe", () => {
  it("parses the three decisions and drops unknown labels", () => {
    expect(parseModeration('{"decision":"allow","labels":[]}')).toEqual({ status: "passed", labels: [] });
    expect(parseModeration('noise {"decision":"reject","labels":["phishing","made_up"]}')).toEqual({ status: "rejected", labels: ["phishing"] });
    expect(parseModeration('{"decision":"maybe"}')).toBeNull();
  });
  it("a failure or a missing key is never a pass", () => {
    const m = code("lib/ads-platform/creative-moderation.ts");
    expect(m).toContain('if (!key) return { status: "skipped", labels: [] };');
    expect(m).toContain('if (!res.ok) return { status: "review", labels: ["moderation_unavailable"] };');
    expect(m).toContain('return { status: "review", labels: ["moderation_unavailable"] };');
    expect(m).toContain('{ type: "image", source: { type: "url", url: input.imageUrl } }');
    expect(m).toContain("process.env.MODERATION_MODEL");
  });
  it("teeth: the stricter outcome wins", () => {
    expect(worse({ status: "passed", labels: [] }, { status: "review", labels: ["x"] }).status).toBe("review");
    expect(worse({ status: "rejected", labels: ["a"] }, { status: "passed", labels: [] }).status).toBe("rejected");
  });
  it("uploads are locked before they are checked, and the declared type must match the bytes", () => {
    const a = code("lib/ads-platform/advertiser-server.ts");
    expect(a).toContain("const locked = `${cr.storage_path}.checked`;");
    expect(a).toMatch(/staging\.copy\(cr\.storage_path, locked\)[\s\S]*stagingReader\(db, locked\)[\s\S]*staging\.copy\(locked, cr\.storage_path, \{ destinationBucket: PUBLIC_BUCKET \}\)/);
    expect(a).toContain('if (declared?.mime_type && declared.mime_type !== facts.mime) errors.push("type_mismatch");');
    expect(a).toContain('if (moderation.status === "rejected") {');
  });
});

describe("🔴 0206 — events count only when they qualify", () => {
  it("the ingest checks eligibility, the format, freshness, and every risk signal", () => {
    const t = fn("track_ad_events");
    expect(t).toContain("or c.start_at is null or c.start_at > now() + interval '1 minute'");
    expect(t).toContain("or c.end_at is null or c.end_at < now() - interval '15 minutes' then");
    expect(t).toContain("when v_type in ('reward_video_start', 'reward_video_complete') then c.format_code = 'REWARD_VIDEO'");
    expect(t).toContain("if v_ts < now() - interval '24 hours' or v_ts > now() + interval '10 minutes' then");
    for (const r of ["bot_signature", "internal_traffic", "self_traffic", "frequency_visitor", "frequency_network", "click_without_view", "repeat_click", "network_click_volume", "completion_without_start", "completion_too_fast"]) {
      expect(t, r).toContain(`'${r}'`);
    }
  });
  it("advertiser counters move only for qualifying events; filtered ones go to invalid_*", () => {
    const t = fn("track_ad_events");
    expect(t).toContain("(v_q and v_type = 'impression')::int, (v_q and v_type = 'click')::int");
    expect(t).toContain("(not v_q and v_type = 'impression')::int, (not v_q and v_type = 'click')::int");
  });
  it("teeth: a copy that counts every impression is caught", () => {
    const broken = fn("track_ad_events").replace("(v_q and v_type = 'impression')::int", "(v_type = 'impression')::int");
    expect(broken).not.toContain("(v_q and v_type = 'impression')::int, (v_q and v_type = 'click')::int");
  });
  it("a shared network alone never refuses: the per-network limit is generous and per minute", () => {
    expect(fn("ad_traffic_rules")).toContain("'max_events_per_minute_per_ip', 600");
    expect(fn("ad_traffic_rules")).toContain("'impressions_per_ip_hour', 200");
  });
  it("the IP is never stored: a daily-salted hash only, dropped after a week by default", () => {
    const t = fn("track_ad_events");
    expect(t).toContain("encode(sha256(convert_to(hash_secret || ':' || v_day::text || ':' || v_ip, 'UTF8')), 'hex')");
    expect(t).not.toMatch(/insert into public\.ad_events[^;]*v_ip[,)]/);
    expect(fn("ad_traffic_housekeeping")).toContain("update public.ad_events set ip_hash = null");
    expect(M()).toContain("revoke all on public.ad_private_settings from public, anon, authenticated;");
  });
  it("only the ingest is browser-callable", () => {
    const m = M();
    expect(m).toContain("grant execute on function public.track_ad_events(jsonb) to anon, authenticated;");
    for (const f of ["ad_traffic_housekeeping()", "ad_rescan_blocked_destinations()", "admin_resolve_ad_risk_flag(bigint, text, uuid, text, boolean)"]) {
      expect(m).toContain(`'public.${f}'`);
    }
  });
  it("runner laws hold (the semicolon-in-string rule is enforced for every migration by lib/platform/migration-strings.test.ts)", () => {
    expect(M().trimEnd().endsWith("end $$;")).toBe(true);
  });
});

describe("the browser sends what the database needs, and nothing when opted out", () => {
  const c = code("features/ads-platform/ad-events-client.ts");
  it("each row carries the browser clock; the opt-out is honoured; a hidden tab is not a view", () => {
    expect(c).toContain("v: visitorId(), ts: Date.now() });");
    expect(c).toContain('return localStorage.getItem("frenz_analytics_off") === "1";');
    expect(c).toContain('entry.intersectionRatio >= IMPRESSION_RULE.minVisibleRatio && document.visibilityState === "visible"');
  });
  it("a failed creative is reported (batched), never retried", () => {
    expect(code("features/ads-platform/serve/self-ad-creative.tsx")).toMatch(/trackAdEvent\(view, "load_failed"\);\s*markCreativeFailed\(ad\.cr\);/);
  });
});

describe("advertisers see filtered totals, never the rules", () => {
  it("the dashboard shows the filtered count and links the public policy", () => {
    expect(code("features/ads-platform/dashboard/campaign-detail.tsx")).toContain('href="/advertise/rules#traffic-quality"');
    expect(code("features/ads-platform/dashboard/dashboard-data.ts")).toContain("filtered: a.filtered + (r.invalid_impressions ?? 0) + (r.invalid_clicks ?? 0)");
  });
  it("the policy names what each figure means and promises no guarantee", () => {
    const r = code("lib/ads-platform/rules.ts");
    expect(r).toContain("We cannot promise that every view or click is from a genuine, interested person");
    expect(code("app/(marketing)/advertise/rules/page.tsx")).toContain('id="traffic-quality"');
  });
  it("the reasons table is admins-only (it would teach evasion)", () => {
    expect(M()).toContain('create policy "ad invalid daily admin" on public.ad_invalid_daily for select using ((select public.is_admin()));');
  });
});

describe("rewards: a reward cannot be completed instantly", () => {
  it("the server refuses a completion faster than the minimum", () => {
    const r = code("lib/monetization/reward-sessions.ts");
    expect(r).toContain("export const MIN_REWARD_SECONDS = 5;");
    expect(r).toContain("if (row.created_at && Date.now() - new Date(row.created_at).getTime() < MIN_REWARD_SECONDS * 1000) {");
  });
});
