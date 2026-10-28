import { describe, expect, it } from "vitest";

import type { MessageItem } from "@/lib/social/messages";

import { cacheThread, getCachedThread, mergeMissing } from "./thread-cache";

const msg = (id: string, at: string) => ({ id, createdAt: at }) as unknown as MessageItem;

describe("mergeMissing", () => {
  it("🔴 a message that arrived while the chat was closed shows on entry", () => {
    const cached = [msg("a", "2026-10-14T12:26:00Z"), msg("b", "2026-10-14T12:28:00Z")];
    const fresh = [...cached, msg("c", "2026-10-14T12:29:00Z")];
    expect(mergeMissing(cached, fresh).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("never brings back an older row the session copy dropped on purpose", () => {
    const cached = [msg("b", "2026-10-14T12:28:00Z")];
    const fresh = [msg("a", "2026-10-14T12:26:00Z"), msg("b", "2026-10-14T12:28:00Z")];
    expect(mergeMissing(cached, fresh).map((m) => m.id)).toEqual(["b"]);
  });

  it("returns the same array when there is nothing new (no repaint)", () => {
    const cached = [msg("a", "2026-10-14T12:26:00Z")];
    expect(mergeMissing(cached, cached)).toBe(cached);
  });
});

describe("the session copy is per account", () => {
  it("🔴 a thread cached by one account is never served to another (owner, 2026-10-28: a received gift on the right)", () => {
    cacheThread("account-a", "conv-1", { messages: [msg("a", "2026-10-28T17:04:00Z")], syncedAt: "2026-10-28T17:04:00Z" });
    expect(getCachedThread("account-a", "conv-1")?.messages).toHaveLength(1);
    expect(getCachedThread("account-b", "conv-1")).toBeUndefined();
  });
});
