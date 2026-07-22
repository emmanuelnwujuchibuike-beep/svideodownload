import { beforeEach, describe, expect, it } from "vitest";

import { __resetBus, emit } from "@/lib/platform/event-bus";

import { installEventTracing } from "./event-observability";
import {
  __resetObservability,
  increment,
  metricsSnapshot,
  recentSpans,
  setSpanExporter,
  withSpan,
} from "./trace";

beforeEach(() => {
  __resetObservability();
  __resetBus();
});

describe("trace — withSpan", () => {
  it("records an ok span and returns the result", async () => {
    const out = await withSpan("op", async () => 42, { kind: "test" });
    expect(out).toBe(42);
    const spans = recentSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toBe("ok");
    expect(spans[0]?.name).toBe("op");
    expect(spans[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records an error span and re-throws", async () => {
    await expect(
      withSpan("bad", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    const span = recentSpans()[0];
    expect(span?.status).toBe("error");
    expect(span?.error).toBe("nope");
  });

  it("bounds the recent-span buffer", async () => {
    for (let i = 0; i < 210; i++) await withSpan(`op-${i}`, () => i);
    expect(recentSpans().length).toBe(200);
    // Oldest were dropped: the last recorded is present, an early one is gone.
    expect(recentSpans().some((s) => s.name === "op-209")).toBe(true);
    expect(recentSpans().some((s) => s.name === "op-0")).toBe(false);
  });
});

describe("trace — exporter", () => {
  it("forwards every span to the exporter", async () => {
    const seen: string[] = [];
    setSpanExporter((s) => seen.push(s.name));
    await withSpan("a", () => 1);
    await withSpan("b", () => 2);
    expect(seen).toEqual(["a", "b"]);
  });

  it("an exporter that throws never breaks the traced operation", async () => {
    setSpanExporter(() => {
      throw new Error("exporter down");
    });
    await expect(withSpan("safe", () => "value")).resolves.toBe("value");
  });
});

describe("trace — metrics", () => {
  it("counts increments", () => {
    increment("hits");
    increment("hits", 4);
    expect(metricsSnapshot().hits).toBe(5);
  });
});

describe("event-observability — the bus is metered", () => {
  it("increments a counter per emitted domain event", () => {
    const off = installEventTracing();
    emit("user.created", { userId: "u1" });
    emit("user.created", { userId: "u2" });
    emit("message.sent", { messageId: "m", conversationId: "c", senderId: "s" });
    const snap = metricsSnapshot();
    expect(snap["event.user.created"]).toBe(2);
    expect(snap["event.message.sent"]).toBe(1);
    off();
  });

  it("is idempotent — installing twice does not double-count", () => {
    const off1 = installEventTracing();
    const off2 = installEventTracing(); // no-op
    emit("follow.created", { followerId: "a", followeeId: "b" });
    expect(metricsSnapshot()["event.follow.created"]).toBe(1);
    off1();
    off2();
  });
});
