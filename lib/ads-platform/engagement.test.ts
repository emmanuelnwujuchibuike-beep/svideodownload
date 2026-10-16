import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { actorKeyFor, parseEngagement } from "./engagement";

/* Owner, 2026-10-15: likes, shares and views on a full-screen ad; anyone can like; views x10. */
const M246 = readFileSync(join(process.cwd(), "supabase/migrations/0246_ad_views_discounts_engagement.sql"), "utf8");

describe("who is liking", () => {
  it("a member by account, a signed-out visitor by the anonymous visitor id", () => {
    expect(actorKeyFor("6e79c281-d056-4371-bbef-c59a0a90941f", "abcdefgh12")).toBe("u:6e79c281-d056-4371-bbef-c59a0a90941f");
    expect(actorKeyFor(null, "0f9a7c2e-1111-4222-8333-944445555666")).toBe("v:0f9a7c2e-1111-4222-8333-944445555666");
  });
  it("teeth: neither, or a malformed id, is nobody", () => {
    expect(actorKeyFor(null, null)).toBeNull();
    expect(actorKeyFor(null, "x;drop")).toBeNull();
    expect(actorKeyFor("not-a-uuid", null)).toBeNull();
  });
  it("the database checks the same shape", () => {
    expect(M246).toContain("check (actor_key ~ '^(u|v):[A-Za-z0-9_-]{8,64}$')");
  });
});

describe("the counts the ad shows", () => {
  it("only a whole, well-formed answer — anything else shows no numbers", () => {
    expect(parseEngagement({ ok: true, views: 3700, likes: 12, shares: 3, liked: true })).toEqual({ views: 3700, likes: 12, shares: 3, liked: true });
    expect(parseEngagement({ ok: false })).toBeNull();
    expect(parseEngagement({ ok: true, likes: 1, shares: 0 })).toBeNull();
    expect(parseEngagement({ ok: true, views: -1, likes: 1, shares: 0 })).toBeNull();
    expect(parseEngagement(null)).toBeNull();
  });
  it("views are the impressions times the campaign's sample-mode multiplier (the dashboard's figure)", () => {
    expect(M246).toContain("* greatest(1, coalesce((to_jsonb(c) ->> 'stats_multiplier')::integer, 1)),");
  });
  it("who liked is never readable by a browser role; the advertiser reads only their own counts", () => {
    expect(M246).toContain("revoke all on public.ad_campaign_reactions from anon, authenticated;");
    expect(M246).toMatch(/create policy "ad engagement own or admin" on public\.ad_campaign_engagement\s+for select using \(\s+campaign_id in \(select c\.id from public\.ad_campaigns c join public\.advertisers a on a\.id = c\.advertiser_id\s+where a\.user_id = \(select auth\.uid\(\)\)\)/);
    expect(M246).toContain("'public.ad_react(uuid, text, text, uuid, boolean)'");
  });
});
