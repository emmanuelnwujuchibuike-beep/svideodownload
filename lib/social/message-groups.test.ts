import { describe, expect, it } from "vitest";

import { GROUP_GAP_MS, sameMessageGroup } from "./message-groups";

const at = (iso: string, senderId = "a", kind?: string) => ({ senderId, createdAt: iso, metadata: kind ? { kind } : null });

describe("chat message groups (one time per group)", () => {
  it("the same sender a minute apart is one group", () => {
    expect(sameMessageGroup(at("2026-10-18T12:00:00"), at("2026-10-18T12:01:00"))).toBe(true);
  });
  it("exactly the gap still groups; one second more does not", () => {
    const t = new Date("2026-10-18T12:00:00").getTime();
    expect(sameMessageGroup(at(new Date(t).toISOString()), at(new Date(t + GROUP_GAP_MS).toISOString()))).toBe(true);
    expect(sameMessageGroup(at(new Date(t).toISOString()), at(new Date(t + GROUP_GAP_MS + 1000).toISOString()))).toBe(false);
  });
  it("another sender, another day, or a system notice breaks the group", () => {
    expect(sameMessageGroup(at("2026-10-18T12:00:00", "a"), at("2026-10-18T12:00:30", "b"))).toBe(false);
    expect(sameMessageGroup(at("2026-10-18T23:59:00"), at("2026-10-19T00:01:00"))).toBe(false);
    expect(sameMessageGroup(at("2026-10-18T12:00:00"), at("2026-10-18T12:00:10", "a", "system"))).toBe(false);
  });
  it("the room uses this rule, not a copy of it", async () => {
    const { readFileSync } = await import("node:fs");
    const room = readFileSync("features/social/conversation-room.tsx", "utf8");
    expect(room).toContain('import { sameMessageGroup } from "@/lib/social/message-groups";');
    expect(room).not.toMatch(/function sameMessageGroup/);
  });
});
