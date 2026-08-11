import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetAttributionForTests, attributeRepost, flush } from "@/lib/social/repost/attribution-client";

/**
 * The batching client is where every analytics number in Part 4 begins, so the
 * rules that keep those numbers honest are asserted here rather than trusted:
 * a no-op on an organic item, one row per (repost, event), and never an actor
 * id in the body.
 */

interface Sent {
  url: string;
  body: unknown;
}

let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  __resetAttributionForTests();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", (url: string, init?: { body?: string }) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const POST = "11111111-1111-1111-1111-111111111111";
const REPOST = "22222222-2222-2222-2222-222222222222";

describe("attributeRepost", () => {
  it("🔴 does nothing for an organic item", () => {
    // Every feed card calls this. Only a SURFACED repost has an id, so the
    // no-op is the common path and callers must not have to branch.
    attributeRepost(null, POST, "impression");
    attributeRepost(undefined, POST, "open");
    flush(false);
    expect(sent).toHaveLength(0);
  });

  it("batches rather than sending one request per event", () => {
    attributeRepost(REPOST, POST, "impression");
    attributeRepost(REPOST, POST, "open");
    expect(sent).toHaveLength(0); // still queued
    flush(false);
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body as { events: unknown[] }).events).toHaveLength(2);
  });

  it("flushes on its own after an idle period", () => {
    attributeRepost(REPOST, POST, "impression");
    vi.advanceTimersByTime(9000);
    expect(sent).toHaveLength(1);
  });

  it("🔴 sends one row per (repost, event), however many times it is called", () => {
    // Scrolling a card in and out of view is not reach. The database's unique
    // index is the real guarantee; this avoids sending what it would reject.
    for (let i = 0; i < 10; i++) attributeRepost(REPOST, POST, "impression");
    flush(false);
    expect((sent[0]!.body as { events: unknown[] }).events).toHaveLength(1);
  });

  it("counts different events on the same repost separately", () => {
    attributeRepost(REPOST, POST, "impression");
    attributeRepost(REPOST, POST, "open");
    attributeRepost(REPOST, POST, "like");
    flush(false);
    expect((sent[0]!.body as { events: unknown[] }).events).toHaveLength(3);
  });

  it("🔴 never puts an actor id in the body", () => {
    // A client that could name the actor could attribute reach to anyone. The
    // server takes it from the session.
    attributeRepost(REPOST, POST, "open");
    flush(false);
    expect(JSON.stringify(sent[0]!.body)).not.toMatch(/actor/i);
  });

  it("flushes at the size cap instead of growing without bound", () => {
    for (let i = 0; i < 12; i++) {
      attributeRepost(`${REPOST.slice(0, -2)}${String(i).padStart(2, "0")}`, POST, "impression");
    }
    expect(sent.length).toBeGreaterThan(0);
  });

  it("does nothing when the queue is empty", () => {
    flush(false);
    flush(true);
    expect(sent).toHaveLength(0);
  });

  it("never throws when the transport is broken", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("offline");
    });
    attributeRepost(REPOST, POST, "impression");
    expect(() => flush(false)).not.toThrow();
  });
});
