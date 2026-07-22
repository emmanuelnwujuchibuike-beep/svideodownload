import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetBus,
  emit,
  observeEvents,
  on,
  setEventErrorHandler,
  subscriberCount,
} from "./event-bus";

beforeEach(() => {
  __resetBus();
  // Capture errors instead of logging, and keep the bus non-throwing.
  setEventErrorHandler(() => {});
});

describe("event-bus — delivery", () => {
  it("delivers a typed payload to a subscriber", () => {
    const seen: string[] = [];
    on("user.created", (p) => {
      seen.push(p.userId);
    });
    emit("user.created", { userId: "u1" });
    expect(seen).toEqual(["u1"]);
  });

  it("delivers to every subscriber", () => {
    let a = 0;
    let b = 0;
    on("message.sent", () => {
      a++;
    });
    on("message.sent", () => {
      b++;
    });
    emit("message.sent", { messageId: "m", conversationId: "c", senderId: "s" });
    expect([a, b]).toEqual([1, 1]);
  });

  it("stops delivery after unsubscribe", () => {
    let count = 0;
    const off = on("follow.created", () => {
      count++;
    });
    emit("follow.created", { followerId: "a", followeeId: "b" });
    off();
    emit("follow.created", { followerId: "a", followeeId: "b" });
    expect(count).toBe(1);
  });

  it("is a no-op when nothing is subscribed", () => {
    expect(() => emit("download.completed", { platform: "tiktok", userId: null })).not.toThrow();
  });
});

describe("event-bus — handler isolation (a listener failure must not break the producer)", () => {
  it("a throwing handler doesn't stop other handlers, and emit never throws", () => {
    const errors: unknown[] = [];
    setEventErrorHandler((_e, err) => errors.push(err));
    let reached = false;
    on("post.published", () => {
      throw new Error("boom");
    });
    on("post.published", () => {
      reached = true;
    });
    expect(() => emit("post.published", { postId: "p", authorId: "a", kind: "post" })).not.toThrow();
    expect(reached).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it("a rejected async handler is caught, not unhandled", async () => {
    const errors: unknown[] = [];
    setEventErrorHandler((_e, err) => errors.push(err));
    on("comment.added", async () => {
      throw new Error("async boom");
    });
    emit("comment.added", { commentId: "c", postId: "p", authorId: "a" });
    // Let the rejected microtask settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
  });
});

describe("event-bus — observability", () => {
  it("observeEvents taps every emit", () => {
    const tapped: string[] = [];
    observeEvents((event) => tapped.push(event));
    emit("reaction.added", { postId: "p", actorId: "a", reaction: "like" });
    emit("subscription.activated", { userId: "u", plan: "pro" });
    expect(tapped).toEqual(["reaction.added", "subscription.activated"]);
  });

  it("subscriberCount reflects registrations", () => {
    expect(subscriberCount("media.processed")).toBe(0);
    const off = on("media.processed", () => {});
    expect(subscriberCount("media.processed")).toBe(1);
    off();
    expect(subscriberCount("media.processed")).toBe(0);
  });
});

describe("event-bus — the isolation actually fires", () => {
  it("routes the error to the configured handler with the event id", () => {
    const captured = vi.fn();
    setEventErrorHandler(captured);
    on("content.reported", () => {
      throw new Error("x");
    });
    emit("content.reported", { targetId: "t", targetType: "post", reporterId: "r" });
    expect(captured).toHaveBeenCalledWith("content.reported", expect.any(Error));
  });
});
