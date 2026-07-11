import { describe, expect, it } from "vitest";

import { aggregateReactions, countUnread } from "./messages";

describe("countUnread", () => {
  it("counts direct-thread unread rows one-per-message, exactly as before", () => {
    const out = countUnread(
      [{ conversation_id: "d1" }, { conversation_id: "d1" }, { conversation_id: "d2" }],
      [],
      new Map(),
    );
    expect(out.get("d1")).toBe(2);
    expect(out.get("d2")).toBe(1);
  });

  it("a group message newer than the viewer's read cursor counts as unread", () => {
    const out = countUnread(
      [],
      [{ conversation_id: "g1", created_at: "2026-07-11T10:00:00.000Z" }],
      new Map([["g1", "2026-07-11T09:00:00.000Z"]]),
    );
    expect(out.get("g1")).toBe(1);
  });

  it("a group message older than (or equal to) the read cursor does NOT count as unread", () => {
    const out = countUnread(
      [],
      [
        { conversation_id: "g1", created_at: "2026-07-11T08:00:00.000Z" },
        { conversation_id: "g1", created_at: "2026-07-11T09:00:00.000Z" },
      ],
      new Map([["g1", "2026-07-11T09:00:00.000Z"]]),
    );
    expect(out.get("g1")).toBeUndefined();
  });

  it("a group the viewer has never opened (no cursor) treats every candidate message as unread", () => {
    const out = countUnread(
      [],
      [
        { conversation_id: "g1", created_at: "2026-07-11T08:00:00.000Z" },
        { conversation_id: "g1", created_at: "2026-07-11T09:00:00.000Z" },
      ],
      new Map(), // no entry for g1 at all
    );
    expect(out.get("g1")).toBe(2);
  });

  it("direct and group counts are independent and both present in the result", () => {
    const out = countUnread(
      [{ conversation_id: "d1" }],
      [{ conversation_id: "g1", created_at: "2026-07-11T10:00:00.000Z" }],
      new Map([["g1", "2026-07-11T09:00:00.000Z"]]),
    );
    expect(out.get("d1")).toBe(1);
    expect(out.get("g1")).toBe(1);
  });
});

describe("aggregateReactions", () => {
  it("groups multiple users' reactions on the same message by emoji, counting each once", () => {
    const out = aggregateReactions(
      [
        { message_id: "m1", user_id: "alice", emoji: "❤️" },
        { message_id: "m1", user_id: "bob", emoji: "❤️" },
        { message_id: "m1", user_id: "carol", emoji: "🔥" },
      ],
      "dave",
    );
    const summary = out.get("m1")!;
    expect(summary.find((r) => r.emoji === "❤️")?.count).toBe(2);
    expect(summary.find((r) => r.emoji === "🔥")?.count).toBe(1);
  });

  it("marks `mine: true` only on the viewer's own reaction, not everyone's", () => {
    const out = aggregateReactions(
      [
        { message_id: "m1", user_id: "alice", emoji: "❤️" },
        { message_id: "m1", user_id: "viewer", emoji: "🔥" },
      ],
      "viewer",
    );
    const summary = out.get("m1")!;
    expect(summary.find((r) => r.emoji === "❤️")?.mine).toBe(false);
    expect(summary.find((r) => r.emoji === "🔥")?.mine).toBe(true);
  });

  it("keeps reactions on different messages in separate buckets", () => {
    const out = aggregateReactions(
      [
        { message_id: "m1", user_id: "alice", emoji: "❤️" },
        { message_id: "m2", user_id: "alice", emoji: "😂" },
      ],
      "viewer",
    );
    expect(out.get("m1")).toHaveLength(1);
    expect(out.get("m2")).toHaveLength(1);
    expect(out.get("m1")![0]!.emoji).toBe("❤️");
  });

  it("a message with no reactions is simply absent from the map", () => {
    const out = aggregateReactions([], "viewer");
    expect(out.get("m1")).toBeUndefined();
    expect(out.size).toBe(0);
  });
});
