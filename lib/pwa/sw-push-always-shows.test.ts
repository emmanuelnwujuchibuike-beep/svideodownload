import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * `public/sw/push.js`, exercised against the REAL file: a push event ALWAYS
 * ends in `showNotification`, whatever the window clients report.
 *
 * ── The bug this pins (owner, 2026-09-13) ──────────────────────────────────
 *
 * "The AI doesn't send a push notification when I'm outside the app and lock
 * my phone screen… it stopped working when I leave the app." The delivery log
 * showed Apple accepting every push (201); the worker then dropped it because
 * a window client still reported `visibilityState: "visible"` — which iOS does
 * for a backgrounded or locked web app — and a push that shows nothing is a
 * silent push, which iOS punishes by revoking the subscription.
 *
 * Same VM harness as the other `sw-*.test.ts` files: the real script, a
 * minimal ServiceWorkerGlobalScope, a synthetic push event.
 */

const SW_DIR = path.resolve(process.cwd(), "public/sw");

interface ClientLike {
  visibilityState: "visible" | "hidden";
  focused: boolean;
}

interface Shown {
  title: string;
  options: Record<string, unknown>;
}

function loadPush(clients: ClientLike[], { matchAllThrows = false }: { matchAllThrows?: boolean } = {}) {
  const shown: Shown[] = [];
  let pushHandler: ((e: unknown) => void) | null = null;
  const sandbox: Record<string, unknown> = {
    Promise,
    Array,
    Object,
    JSON,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  sandbox.self = sandbox;
  (sandbox as { self: Record<string, unknown> }).self.SWX = { log: () => {} };
  (sandbox as { self: Record<string, unknown> }).self.navigator = {};
  (sandbox as { self: Record<string, unknown> }).self.registration = {
    showNotification: async (title: string, options: Record<string, unknown>) => {
      shown.push({ title, options });
    },
  };
  (sandbox as { self: Record<string, unknown> }).self.clients = {
    matchAll: async () => {
      if (matchAllThrows) throw new Error("clients unavailable");
      return clients;
    },
  };
  (sandbox as { self: Record<string, unknown> }).self.addEventListener = (type: string, fn: unknown) => {
    if (type === "push") pushHandler = fn as (e: unknown) => void;
  };
  runInNewContext("this", sandbox);
  runInNewContext(readFileSync(path.join(SW_DIR, "push.js"), "utf8"), sandbox, { filename: "push.js" });
  if (!pushHandler) throw new Error("push.js registered no push handler");

  const fire = async (payload: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    (pushHandler as (e: unknown) => void)({
      data: { json: () => payload, text: () => JSON.stringify(payload) },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
  };
  return { fire, shown };
}

const AI_DONE = { title: "Your video is ready", body: "AI Clean finished.", tag: "ai-clean-done", url: "/ai/clean?job=1" };

describe("push.js — a push always ends in a visible notification", () => {
  it("shows the notification when no window is open", async () => {
    const { fire, shown } = loadPush([]);
    await fire(AI_DONE);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe("Your video is ready");
    expect(shown[0]!.options.silent).toBeUndefined();
  });

  it("🔴 still shows it when a client reports visible but NOT focused — iOS in a pocket", async () => {
    const { fire, shown } = loadPush([{ visibilityState: "visible", focused: false }]);
    await fire(AI_DONE);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.options.silent).toBeUndefined();
  });

  it("🔴 still shows it when the app is genuinely in the foreground — quietly", async () => {
    const { fire, shown } = loadPush([{ visibilityState: "visible", focused: true }]);
    await fire(AI_DONE);
    expect(shown, "a push that shows nothing is a silent push; iOS revokes for those").toHaveLength(1);
    expect(shown[0]!.options.silent).toBe(true);
    expect(shown[0]!.options.tag).toBe("ai-clean-done");
  });

  it("a forced (smoke-test) push is never made quiet", async () => {
    const { fire, shown } = loadPush([{ visibilityState: "visible", focused: true }]);
    await fire({ ...AI_DONE, force: true });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.options.silent).toBeUndefined();
  });

  it("shows it even when the clients query itself throws", async () => {
    const { fire, shown } = loadPush([], { matchAllThrows: true });
    await fire(AI_DONE);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.options.silent).toBeUndefined();
  });
});
