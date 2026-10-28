import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Gift Coin Part 4.1: sendPushToUser now REPORTS what it did (devices tried, devices whose push service accepted),
 * so the gift outbox records "sent" only on acceptance. The sender itself is unchanged: a 404/410 still prunes the
 * subscription (no retry), any other failure is retried once, and a failure never throws. web-push is mocked — no real
 * push leaves this test.
 */
let db: FakeDb;
const answers: Record<string, (number | null)[]> = {};
const calls: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }) => {
      calls.push(sub.endpoint);
      const code = answers[sub.endpoint]?.shift() ?? null;
      if (code === null) return { statusCode: 201 };
      throw Object.assign(new Error("push refused"), { statusCode: code });
    },
  },
}));

const load = async () => {
  vi.resetModules();
  vi.stubEnv("VAPID_PUBLIC_KEY", "test-public");
  vi.stubEnv("VAPID_PRIVATE_KEY", "test-private");
  return import("./web-push");
};
const U = "00000000-0000-4000-8000-000000000001";
const sub = (id: string, endpoint: string) => ({ id, user_id: U, endpoint, p256dh: "k", auth: "a" });

beforeEach(() => {
  db = fakeDb({ push_subscriptions: [], push_delivery_log: [] });
  for (const k of Object.keys(answers)) delete answers[k];
  calls.length = 0;
});

describe("sendPushToUser reports the outcome", () => {
  it("no device: 0 tried, 0 accepted", async () => {
    const w = await load();
    expect(await w.sendPushToUser(U, { title: "t", body: "b" })).toEqual({ devices: 0, accepted: 0 });
  });
  it("two devices accepted: 2 / 2", async () => {
    db.tables.push_subscriptions = [sub("s1", "https://push.example/1"), sub("s2", "https://push.example/2")];
    const w = await load();
    expect(await w.sendPushToUser(U, { title: "t", body: "b" })).toEqual({ devices: 2, accepted: 2 });
  });
  it("a dead endpoint (410) is pruned and not counted; the live one is", async () => {
    db.tables.push_subscriptions = [sub("dead", "https://push.example/dead"), sub("live", "https://push.example/live")];
    answers["https://push.example/dead"] = [410];
    const w = await load();
    expect(await w.sendPushToUser(U, { title: "t", body: "b" })).toEqual({ devices: 2, accepted: 1 });
    expect(db.tables.push_subscriptions!.map((s) => s.id)).toEqual(["live"]);
    expect(calls.filter((c) => c.endsWith("/dead"))).toHaveLength(1);
  });
  it("a transient failure is retried once and counts when the retry is accepted", async () => {
    db.tables.push_subscriptions = [sub("s1", "https://push.example/1")];
    answers["https://push.example/1"] = [500, null];
    const w = await load();
    expect(await w.sendPushToUser(U, { title: "t", body: "b" })).toEqual({ devices: 1, accepted: 1 });
  });
  it("refused twice: tried, not accepted, not pruned (a slow device is not a dead one)", async () => {
    db.tables.push_subscriptions = [sub("s1", "https://push.example/1")];
    answers["https://push.example/1"] = [500, 500];
    const w = await load();
    expect(await w.sendPushToUser(U, { title: "t", body: "b" })).toEqual({ devices: 1, accepted: 0 });
    expect(db.tables.push_subscriptions).toHaveLength(1);
  });
});
