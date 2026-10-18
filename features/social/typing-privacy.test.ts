import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  announceTypingRevoked,
  INBOX_TYPING_ROWS,
  roomTypingTopic,
  rowSubscribesTyping,
  TYPING_REVOKED_EVENT,
  type TypingRevokedDetail,
} from "./typing-privacy";

/**
 * Typing indicator privacy (owner, 2026-10-18). Ghost Mode is reciprocal: a member who hides
 * their typing neither sends nor sees it — in the open thread and in the inbox — and the inbox
 * subscribes only once the setting is KNOWN to be on. The server half (who may join a typing
 * channel at all) is proven against Postgres: supabase/tests/0259_typing_authorization.pglite.mjs.
 */

describe("the open thread's typing topic", () => {
  it("typing on: the thread joins its own conversation's channel (sends and receives)", () => {
    expect(roomTypingTopic("c1", true, false)).toBe("c1");
  });
  it("typing off (Ghost Mode): no channel at all — nothing sent, nothing shown, direct or group", () => {
    expect(roomTypingTopic("c1", false, false)).toBe("");
  });
  it("a block or messaging restriction confirmed from this thread drops the channel", () => {
    expect(roomTypingTopic("c1", true, true)).toBe("");
  });
});

describe("inbox rows", () => {
  it("subscribe only when the viewer's setting is known to be on, within the row cap", () => {
    expect(rowSubscribesTyping(0, true)).toBe(true);
    expect(rowSubscribesTyping(INBOX_TYPING_ROWS - 1, true)).toBe(true);
    expect(rowSubscribesTyping(INBOX_TYPING_ROWS, true)).toBe(false);
  });
  it("Ghost Mode, or a setting not loaded yet (device-cached paint), subscribes nothing", () => {
    expect(rowSubscribesTyping(0, false)).toBe(false);
    expect(rowSubscribesTyping(0, undefined)).toBe(false);
  });
  it("teeth: the old rule (cap only) would subscribe a hidden member's inbox", () => {
    const oldRule = (i: number) => i < 25;
    expect(oldRule(0)).not.toBe(rowSubscribesTyping(0, false));
  });
});

describe("revocation event", () => {
  const original = (globalThis as { window?: unknown }).window;
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = new EventTarget();
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  it("announces the conversation it was revoked for, and nothing for an empty id", () => {
    const seen: string[] = [];
    const w = (globalThis as unknown as { window: EventTarget }).window;
    w.addEventListener(TYPING_REVOKED_EVENT, (e) => seen.push((e as CustomEvent<TypingRevokedDetail>).detail.conversationId));
    announceTypingRevoked("c1");
    announceTypingRevoked("");
    expect(seen).toEqual(["c1"]);
  });
});

describe("the inbox cache keeps the setting across partial refreshes", () => {
  const row = (id: string, lastAt: string) => ({ id, lastAt, pinned: false, unread: false }) as never;

  it("mergeInboxRows preserves typingIndicatorsEnabled (both values)", async () => {
    const { mergeInboxRows } = await import("@/features/social/inbox");
    for (const flag of [true, false]) {
      const prev = { conversations: [row("a", "2026-10-18T10:00:00Z")], unread: 0, typingIndicatorsEnabled: flag };
      const out = mergeInboxRows(prev, ["a"], [row("a", "2026-10-18T11:00:00Z")]);
      expect(out.typingIndicatorsEnabled).toBe(flag);
    }
  });
  it("a cache that never had it stays unknown (rows keep not subscribing)", async () => {
    const { mergeInboxRows } = await import("@/features/social/inbox");
    const out = mergeInboxRows({ conversations: [row("a", "2026-10-18T10:00:00Z")], unread: 0 }, ["a"], [row("a", "2026-10-18T11:00:00Z")]);
    expect(out.typingIndicatorsEnabled).toBeUndefined();
  });
});

// ── the server read and the API response ────────────────────────────────────

const adminResult = vi.hoisted(() => ({ value: { data: null as unknown, error: null as unknown } as { data: unknown; error: unknown }, throws: false }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (adminResult.throws) throw new Error("boom");
    const q = { select: () => q, eq: () => q, maybeSingle: async () => adminResult.value };
    return { from: () => q };
  },
}));

describe("viewerTypingIndicatorsEnabled (one primary-key read per full inbox load)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
    vi.resetModules();
    adminResult.throws = false;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads the saved value, defaults to on when there is no row, and is unknown on a fault", async () => {
    // the real reader (this file also mocks the module for the route tests below)
    const { viewerTypingIndicatorsEnabled } = await vi.importActual<typeof import("@/lib/social/messages")>("@/lib/social/messages");
    adminResult.value = { data: { typing_indicators_enabled: false }, error: null };
    expect(await viewerTypingIndicatorsEnabled("u1")).toBe(false);
    adminResult.value = { data: { typing_indicators_enabled: true }, error: null };
    expect(await viewerTypingIndicatorsEnabled("u1")).toBe(true);
    adminResult.value = { data: null, error: null };
    expect(await viewerTypingIndicatorsEnabled("u1")).toBe(true);
    adminResult.value = { data: null, error: { message: "fault" } };
    expect(await viewerTypingIndicatorsEnabled("u1")).toBeUndefined();
    adminResult.throws = true;
    expect(await viewerTypingIndicatorsEnabled("u1")).toBeUndefined();
  });
});

const api = vi.hoisted(() => ({ typing: true as boolean | undefined, listCalls: [] as unknown[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "viewer-1" } } }) } }),
}));
vi.mock("@/lib/rate-limit", () => ({ messageLimiter: { limit: async () => ({ success: true }) } }));
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: async () => undefined }));
vi.mock("@/lib/social/friends", () => ({ listIncomingFriendRequests: async () => [] }));
vi.mock("@/lib/social/messages", async (orig) => ({
  ...(await orig<typeof import("@/lib/social/messages")>()),
  listConversations: async (...args: unknown[]) => {
    api.listCalls.push(args);
    return [{ id: "c1", unread: true }];
  },
  viewerTypingIndicatorsEnabled: async () => api.typing,
}));

describe("GET /api/messages", () => {
  beforeEach(() => {
    api.listCalls = [];
  });

  it("the full inbox carries the viewer's typing setting", async () => {
    const { GET } = await import("@/app/api/messages/route");
    api.typing = false;
    const off = await (await GET(new Request("http://x/api/messages"))).json();
    expect(off).toEqual({ conversations: [{ id: "c1", unread: true }], unread: 1, typingIndicatorsEnabled: false });
    api.typing = true;
    expect((await (await GET(new Request("http://x/api/messages"))).json()).typingIndicatorsEnabled).toBe(true);
  });
  it("a fault leaves it out — the client then treats it as unknown and subscribes nothing", async () => {
    const { GET } = await import("@/app/api/messages/route");
    api.typing = undefined;
    const body = await (await GET(new Request("http://x/api/messages"))).json();
    expect("typingIndicatorsEnabled" in body).toBe(false);
  });
  it("the ?ids= partial does not carry it (the cache keeps the full load's value)", async () => {
    const { GET } = await import("@/app/api/messages/route");
    const body = await (await GET(new Request("http://x/api/messages?ids=10000000-0000-4000-8000-000000000001"))).json();
    expect(body.partial).toBe(true);
    expect("typingIndicatorsEnabled" in body).toBe(false);
  });
});
