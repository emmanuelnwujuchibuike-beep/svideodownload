import { describe, expect, it } from "vitest";

import type { MessageItem } from "@/lib/social/messages";

import { mergeMissing } from "./thread-cache";

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
