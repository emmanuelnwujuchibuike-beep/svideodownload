import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { actorKeyFor } from "@/lib/ads-platform/engagement";

/*
  Owner, 2026-10-16: "make ad likes also take effect in the x10 multiplier when is turned on, anonymous
  users can like an Ad more than once every visit and it counts but signed in users likes only stays
  ones to that account". The multiplier itself is proven in Postgres (supabase/tests/0249_*.pglite.mjs).
*/

const sent: { url: string; body?: Record<string, unknown> }[] = [];
beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "frenz_vid" ? "persistentVisitor1" : null) });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: true, json: async () => ({ ok: true, views: 370, likes: 30, shares: 2, liked: true }) };
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("who a like belongs to", () => {
  it("a signed-out visitor likes with a per-visit id: the same all visit long, a new one next visit", async () => {
    const a = await import("./ad-engagement");
    await a.reactToAd("c1", "like", true);
    await a.reactToAd("c1", "like", false);
    await a.loadAdEngagement("c2");
    const ids = [sent[0]!.body!.v, sent[1]!.body!.v, new URL(sent[2]!.url, "https://x").searchParams.get("v")];
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).not.toBe("persistentVisitor1");
    expect(String(ids[0])).toMatch(/^[A-Za-z0-9_-]{8,64}$/); // the shape the route and the database accept
    vi.resetModules();
    const b = await import("./ad-engagement");
    await b.reactToAd("c1", "like", true);
    expect(sent[3]!.body!.v).not.toBe(ids[0]); // next visit: a new id, so the like counts again
  });

  it("a share keeps the persistent visitor id (once per visitor)", async () => {
    const a = await import("./ad-engagement");
    await a.reactToAd("c1", "share", true);
    expect(sent[0]!.body!.v).toBe("persistentVisitor1");
  });

  it("a signed-in member is keyed by ACCOUNT whatever id the browser sends — one like per account", () => {
    const user = "6e79c281-d056-4371-bbef-c59a0a90941f";
    expect(actorKeyFor(user, "pvAAAAAAAAAA")).toBe(`u:${user}`);
    expect(actorKeyFor(user, "pvBBBBBBBBBB")).toBe(`u:${user}`);
    expect(actorKeyFor(null, "pvAAAAAAAAAA")).toBe("v:pvAAAAAAAAAA");
  });

  it("0249 multiplies likes the way views already are, and only for display", () => {
    const m = readFileSync(join(process.cwd(), "supabase/migrations/0249_ad_likes_multiplier.sql"), "utf8");
    expect(m).toContain("'likes', coalesce(e.likes, 0)::bigint * greatest(1, coalesce((to_jsonb(c) ->> 'stats_multiplier')::integer, 1)),");
    expect(m).not.toMatch(/update public\.ad_campaign_engagement/);
  });
});
