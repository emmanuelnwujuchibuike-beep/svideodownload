import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestTypingPush, shouldRequestTypingPush, TYPING_PUSH_COOLDOWN_MS, type TypingPushContext } from "./typing-privacy";

/**
 * "… is typing" push (owner, 2026-10-18): direct chats only, only when the other person's app is
 * closed, at most once per 5 minutes per sender per chat. Three layers, each tested on its own
 * behaviour: the client gate, the server's recipient check, and the route's window + delivery.
 */

const base: TypingPushContext = { conversationType: "direct", typingEnabled: true, revoked: false, otherId: "u2", otherOnline: false };

describe("client gate — when a keystroke may ask for a typing push", () => {
  it("asks in a direct chat when the other person is off the app", () => {
    expect(shouldRequestTypingPush(base, 1_000, undefined)).toBe(true);
  });
  it("never in a group or secret chat", () => {
    expect(shouldRequestTypingPush({ ...base, conversationType: "group" }, 1_000, undefined)).toBe(false);
    expect(shouldRequestTypingPush({ ...base, conversationType: "secret" }, 1_000, undefined)).toBe(false);
  });
  it("never while the other person is on the app (they see typing live)", () => {
    expect(shouldRequestTypingPush({ ...base, otherOnline: true }, 1_000, undefined)).toBe(false);
  });
  it("never from someone in Ghost Mode, or after a block/restriction from this chat", () => {
    expect(shouldRequestTypingPush({ ...base, typingEnabled: false }, 1_000, undefined)).toBe(false);
    expect(shouldRequestTypingPush({ ...base, revoked: true }, 1_000, undefined)).toBe(false);
    expect(shouldRequestTypingPush({ ...base, otherId: null }, 1_000, undefined)).toBe(false);
  });
  it("once per 5 minutes per chat", () => {
    expect(shouldRequestTypingPush(base, 1_000 + TYPING_PUSH_COOLDOWN_MS - 1, 1_000)).toBe(false);
    expect(shouldRequestTypingPush(base, 1_000 + TYPING_PUSH_COOLDOWN_MS, 1_000)).toBe(true);
  });
});

describe("requestTypingPush — one request per typing session, not per keystroke", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response("{}");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fifty keystrokes in one chat make ONE request; the next comes after 5 minutes", () => {
    const t0 = 10_000_000;
    for (let i = 0; i < 50; i++) requestTypingPush("chat-a", base, t0 + i * 200);
    expect(calls).toEqual(["/api/messages/chat-a/typing"]);
    requestTypingPush("chat-a", base, t0 + TYPING_PUSH_COOLDOWN_MS);
    expect(calls).toHaveLength(2);
  });
  it("another chat has its own window; a gated keystroke makes no request", () => {
    const t0 = 20_000_000;
    expect(requestTypingPush("chat-b", base, t0)).toBe(true);
    expect(requestTypingPush("chat-c", { ...base, otherOnline: true }, t0)).toBe(false);
    expect(calls).toEqual(["/api/messages/chat-b/typing"]);
  });
});

// ── server: who gets it ─────────────────────────────────────────────────────

type Table = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Table> }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = () => db.tables[table] ?? { data: null, count: 0 };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "or", "neq"]) q[m] = () => q;
      q.maybeSingle = async () => result();
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
  }),
}));

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const CONV = "c0000000-0000-4000-8000-000000000003";
function world(over: Partial<Record<string, Table>> = {}) {
  db.tables = {
    conversations: { data: { type: "direct", user_low: A, user_high: B } },
    conversation_members: { data: [{ user_id: A, muted: false }, { user_id: B, muted: false }] },
    privacy_settings: { data: [] },
    profiles: { data: { display_name: "Chris", handle: "chris", avatar_url: null } },
    blocks: { count: 0 },
    user_restrictions: { count: 0 },
    ...over,
  };
}

describe("typingPushTarget — the server's own check (never trusts the client)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());
  const target = async () => (await vi.importActual<typeof import("@/lib/social/messages")>("@/lib/social/messages")).typingPushTarget(A, CONV);

  it("a clean direct chat: the other member, with the sender's name", async () => {
    world();
    expect(await target()).toEqual({ recipientId: B, senderName: "Chris", senderAvatar: null });
  });
  it("not a group chat", async () => {
    world({ conversations: { data: { type: "group", user_low: null, user_high: null } } });
    expect(await target()).toBeNull();
  });
  it("not when the sender isn't in the pair, or either side left", async () => {
    world({ conversations: { data: { type: "direct", user_low: B, user_high: "d0000000-0000-4000-8000-000000000009" } } });
    expect(await target()).toBeNull();
    world({ conversation_members: { data: [{ user_id: A, muted: false }] } });
    expect(await target()).toBeNull();
    world({ conversation_members: { data: [{ user_id: B, muted: false }] } });
    expect(await target()).toBeNull();
  });
  it("not when the recipient muted the chat", async () => {
    world({ conversation_members: { data: [{ user_id: A, muted: false }, { user_id: B, muted: true }] } });
    expect(await target()).toBeNull();
  });
  it("not when EITHER side has typing off (Ghost Mode is reciprocal)", async () => {
    world({ privacy_settings: { data: [{ user_id: B, typing_indicators_enabled: false }] } });
    expect(await target()).toBeNull();
    world({ privacy_settings: { data: [{ user_id: A, typing_indicators_enabled: false }] } });
    expect(await target()).toBeNull();
  });
  it("not across a block or a messaging restriction (the rule sending uses)", async () => {
    world({ blocks: { count: 1 } });
    expect(await target()).toBeNull();
    world({ user_restrictions: { count: 1 } });
    expect(await target()).toBeNull();
  });
});

// ── the route: window first, then the check, then one push ─────────────────

const route = vi.hoisted(() => ({ user: { id: "a0000000-0000-4000-8000-000000000001" } as { id: string } | null, n: 1, target: null as unknown, pushes: [] as unknown[][] }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: route.user } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ bumpEphemeralCount: async () => route.n }));
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: async (...args: unknown[]) => void route.pushes.push(args) }));
vi.mock("@/lib/social/messages", async (orig) => ({ ...(await orig<typeof import("@/lib/social/messages")>()), typingPushTarget: async () => route.target }));

describe("POST /api/messages/:id/typing", () => {
  const call = async (id = CONV) => {
    const { POST } = await import("@/app/api/messages/[id]/typing/route");
    const res = await POST(new Request(`http://x/api/messages/${id}/typing`, { method: "POST" }), { params: Promise.resolve({ id }) });
    await new Promise((r) => setTimeout(r, 0));
    return { status: res.status, body: await res.json() };
  };
  beforeEach(() => {
    route.user = { id: A };
    route.n = 1;
    route.target = { recipientId: B, senderName: "Chris", senderAvatar: null };
    route.pushes = [];
  });

  it("first ask in the window: one push to the recipient, the chat's own tag, a short life, no in-app row", async () => {
    const r = await call();
    expect(r).toEqual({ status: 200, body: { sent: true } });
    expect(route.pushes).toHaveLength(1);
    const [to, payload, priority, category, record] = route.pushes[0] as [string, Record<string, unknown>, string, string, string];
    expect(to).toBe(B);
    expect(payload).toMatchObject({ title: "Chris", body: "is typing…", tag: `msg:${CONV}`, url: `/messages/${CONV}`, conversationId: CONV, ttlSeconds: 60 });
    expect([priority, category, record]).toEqual(["medium", "social", "already-recorded"]);
  });
  it("a second ask inside 5 minutes sends nothing — and Redis missing (0) sends nothing either", async () => {
    route.n = 2;
    expect((await call()).body).toEqual({ sent: false });
    route.n = 0;
    expect((await call()).body).toEqual({ sent: false });
    expect(route.pushes).toHaveLength(0);
  });
  it("the server's check refusing (block, mute, Ghost Mode, group…) sends nothing", async () => {
    route.target = null;
    expect((await call()).body).toEqual({ sent: false });
    expect(route.pushes).toHaveLength(0);
  });
  it("signed out → 401; a malformed id → 404; neither sends", async () => {
    route.user = null;
    expect((await call()).status).toBe(401);
    route.user = { id: A };
    expect((await call("not-a-uuid")).status).toBe(404);
    expect(route.pushes).toHaveLength(0);
  });
});
