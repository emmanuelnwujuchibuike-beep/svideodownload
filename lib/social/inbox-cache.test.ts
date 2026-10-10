import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearInboxCache, INBOX_CACHE_MAX_ROWS, INBOX_CACHE_TTL_MS, readInboxCache, writeInboxCache } from "./inbox-cache";
import type { ConversationSummary } from "./messages";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const row = (i: number) => ({ id: `c${i}`, lastAt: new Date(0).toISOString(), unread: false, pinned: false }) as unknown as ConversationSummary;

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("the inbox is painted from the device, per account (owner, 2026-10-10: 'it should open instant')", () => {
  it("what one account saved is read back for that account", () => {
    writeInboxCache("amaka", { conversations: [row(1), row(2)], unread: 1 }, [], 1000);
    expect(readInboxCache("amaka", 2000)?.conversations.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("teeth: another account on the same phone never sees it, nor does a signed-out one", () => {
    writeInboxCache("amaka", { conversations: [row(1)], unread: 0 }, null, 1000);
    expect(readInboxCache("bola", 2000)).toBeNull();
    expect(readInboxCache(null, 2000)).toBeNull();
    writeInboxCache(null, { conversations: [row(9)], unread: 0 }, null, 1000);
    expect(readInboxCache("amaka", 2000)?.conversations[0]?.id).toBe("c1");
  });

  it("it expires, is bounded, and is gone after clearInboxCache", () => {
    writeInboxCache("amaka", { conversations: Array.from({ length: 200 }, (_, i) => row(i)), unread: 0 }, null, 1000);
    expect(readInboxCache("amaka", 2000)?.conversations).toHaveLength(INBOX_CACHE_MAX_ROWS);
    expect(readInboxCache("amaka", 1000 + INBOX_CACHE_TTL_MS + 1)).toBeNull();
    clearInboxCache();
    expect(readInboxCache("amaka", 2000)).toBeNull();
  });

  it("saving the list keeps the saved requests, and the other way round", () => {
    writeInboxCache("amaka", { conversations: [row(1)], unread: 0 }, [{ id: "r1" } as never], 1000);
    writeInboxCache("amaka", { conversations: [row(2)], unread: 0 }, null, 1100);
    expect(readInboxCache("amaka", 1200)?.requests?.map((r) => r.id)).toEqual(["r1"]);
  });

  it("sign-out clears it (and the cached chat faces with the other images)", () => {
    const signOut = src("lib/auth/sign-out.ts");
    expect(signOut).toContain("clearInboxCache();");
    expect(signOut).toContain('n.startsWith("frenz-avatar-")');
  });

  it("/messages and its desktop pane render without waiting on the server", () => {
    for (const f of ["app/(app)/messages/page.tsx", "app/(app)/messages/layout.tsx"]) {
      // code only — the page's history comment names what it used to await
      const code = src(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, f).toContain("<InstantInbox");
      expect(code, f).not.toMatch(/listConversations|listIncomingFriendRequests|getUserBounded|await /);
    }
  });
});
