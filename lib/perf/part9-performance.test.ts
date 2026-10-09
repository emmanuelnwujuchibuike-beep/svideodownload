import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAdaptivePoll } from "@/features/data/adaptive-poll";
import { isPublicWallpaperUrl, isStorageObjectPath, MEDIA_PROXY_MAX_BYTES } from "@/lib/media/proxy-guard";

/**
 * Part 9 — application-wide performance. Behaviour is tested where it is pure
 * (the adaptive poll, the media proxy guard, the shared notification stream);
 * the rest pins the shipped text, with a teeth case per family.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ── a minimal document for the poll (vitest runs in node) ────────────────────
class FakeDoc extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  hide() {
    this.visibilityState = "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
  show() {
    this.visibilityState = "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

describe("adaptive poll: fast while a conversation is live, silent while hidden", () => {
  let doc: FakeDoc;
  beforeEach(() => {
    vi.useFakeTimers();
    doc = new FakeDoc();
    vi.stubGlobal("document", doc);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls fast for the active window, then slows down", async () => {
    const run = vi.fn(async () => false);
    const p = startAdaptivePoll(run, { fastMs: 1000, slowMs: 10_000, fastForMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(9000);
    // past the fast window: at most one more poll in 9 s, not nine
    expect(run.mock.calls.length).toBeLessThanOrEqual(6);
    p.stop();
  });

  it("never polls while hidden, and checks at once when visible again", async () => {
    const run = vi.fn(async () => false);
    const p = startAdaptivePoll(run, { fastMs: 1000, slowMs: 1000 });
    doc.hide();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(0);
    doc.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("teeth: bumps and visibility events never start a second chain", async () => {
    const run = vi.fn(async () => false);
    const p = startAdaptivePoll(run, { fastMs: 1000, slowMs: 1000 });
    // mid-period, with a timer pending: the shape of the old double-chain bug
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(400);
      doc.show();
      await vi.advanceTimersByTimeAsync(0);
      p.bump();
      await vi.advanceTimersByTimeAsync(0);
    }
    const afterBurst = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    // one chain → exactly five more polls in five periods
    expect(run.mock.calls.length - afterBurst).toBe(5);
    p.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.mock.calls.length - afterBurst).toBe(5);
  });

  it("activity reported by run() keeps it fast", async () => {
    let n = 0;
    const run = vi.fn(async () => ++n % 2 === 0);
    const p = startAdaptivePoll(run, { fastMs: 1000, slowMs: 60_000, fastForMs: 1500 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(8);
    p.stop();
  });

  it("the secret and support chats use it, and bump after a send", () => {
    const secret = code("features/social/secret-chat-room.tsx");
    const support = code("features/support/support-chat.tsx");
    for (const s of [secret, support]) {
      expect(s).toContain("startAdaptivePoll(");
      expect(s).toContain("pollRef.current?.bump()");
      expect(s).not.toMatch(/setInterval\(\s*(?:tick|poll|load)/);
    }
  });
});

describe("/api/media/download: our own objects only, bounded", () => {
  const SB = "https://abc.supabase.co";
  it("the public wallpaper shortcut is decided on the parsed URL", () => {
    expect(isPublicWallpaperUrl(new URL(`${SB}/storage/v1/object/public/wallpapers/a.jpg`), SB)).toBe(true);
  });
  it("teeth: a query, another bucket or another host never skips sign-in", () => {
    expect(isPublicWallpaperUrl(new URL(`${SB}/storage/v1/object/public/private/a.jpg?x=/wallpapers/`), SB)).toBe(false);
    expect(isPublicWallpaperUrl(new URL(`${SB}/storage/v1/object/public/wallpapers/a.jpg?token=1`), SB)).toBe(false);
    expect(isPublicWallpaperUrl(new URL("https://evil.example/storage/v1/object/public/wallpapers/a.jpg"), SB)).toBe(false);
    expect(isPublicWallpaperUrl(new URL(`${SB}/storage/v1/object/public/wallpapers/a.jpg`), undefined)).toBe(false);
  });
  it("only storage objects on the Supabase host, never REST or auth", () => {
    expect(isStorageObjectPath(new URL(`${SB}/storage/v1/object/sign/x/y`), SB)).toBe(true);
    expect(isStorageObjectPath(new URL(`${SB}/rest/v1/profiles`), SB)).toBe(false);
    expect(isStorageObjectPath(new URL(`${SB}/auth/v1/admin/users`), SB)).toBe(false);
  });
  it("the route refuses redirects and unknown or oversized bodies, and is rate-limited", () => {
    const r = code("app/api/media/download/route.ts");
    expect(r).toContain('redirect: "manual"');
    expect(r).toContain("MEDIA_PROXY_MAX_BYTES");
    expect(r).toContain("413");
    expect(r).toContain("downloadLimiter.limit(`media-save:${clientId(request.headers)}`)");
    expect(MEDIA_PROXY_MAX_BYTES).toBe(200 * 1024 * 1024);
  });
});

describe("one notification channel app-wide", () => {
  const channel = vi.fn();
  const removeChannel = vi.fn();
  beforeEach(() => {
    channel.mockReset();
    removeChannel.mockReset();
    vi.resetModules();
    vi.doMock("@/lib/supabase/client", () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return { createClient: () => ({ channel: (n: string) => (channel(n), ch), removeChannel }) };
    });
    vi.doMock("@/lib/supabase/client-user", () => ({ getClientAuthUser: async () => ({ data: { user: { id: "u1" } } }) }));
  });

  it("three listeners share one channel; the last one out closes it", async () => {
    const { onNotificationInsert, notificationStreamState } = await import("@/features/notifications/notif-stream");
    const offs = [onNotificationInsert(() => {}), onNotificationInsert(() => {}), onNotificationInsert(() => {})];
    await Promise.resolve();
    await Promise.resolve();
    expect(channel).toHaveBeenCalledTimes(1);
    offs[0]!();
    offs[1]!();
    expect(notificationStreamState().open).toBe(true);
    offs[2]!();
    expect(notificationStreamState()).toEqual({ listeners: 0, open: false });
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("teeth: no component opens its own channel on the notifications table any more", () => {
    for (const f of ["features/app-shell/notification-bell.tsx", "features/notifications/live-toast.tsx", "features/notifications/notification-center.tsx"]) {
      const s = code(f);
      expect(s, f).toContain("onNotificationInsert(");
      expect(s, f).not.toContain('table: "notifications"');
    }
  });
});

describe("background work stops when nobody is looking", () => {
  it("presence untracks after the page is hidden and listens to taps, not mouse moves", () => {
    const p = code("features/friends/use-presence.ts");
    expect(p).toContain("visibilitychange");
    expect(p).toContain("untrack");
    expect(p).not.toContain('"mousemove"');
  });
  it("typing indicators share one sweep that runs only while needed", () => {
    const t = code("features/social/use-typing.ts");
    expect(t).toContain("syncSweep");
    expect(t).not.toContain("staleInterval");
  });
  it("the feed no longer subscribes to every post insert on the table", () => {
    const f = code("features/feed/smart-feed.tsx");
    expect(f).not.toContain("smart-feed-posts");
    expect(f).not.toContain("postgres_changes");
  });
  it("job watchers stop the old chain before polling on return", () => {
    for (const f of ["features/ai/core/use-job-watch.ts", "features/ai/character-replace/use-batch-watch.ts"]) {
      expect(code(f), f).toMatch(/stop\(\);\s*\n?\s*(?:void )?poll\(\)/);
    }
  });
  it("story progress re-renders in 2 % steps, not every frame", () => {
    expect(code("features/app-shell/dashboard/stories-row.tsx")).toMatch(/0\.02|2 ?%|\* ?50/);
    expect(code("features/ads-platform/serve/self-story-card.tsx")).toMatch(/0\.02|2 ?%|\* ?50/);
  });
  it("videos release their decoder on unmount (stable ref callback)", () => {
    const v = code("features/media/smart-video.tsx");
    expect(v).toContain("function releaseOnUnmount(");
    expect(v).toContain("ref={releaseOnUnmount}");
  });
});

describe("shared answers are cached at the edge", () => {
  it("the rewards list, sound discovery and the tools feed carry s-maxage", () => {
    expect(code("app/api/rewards/public/route.ts")).toContain("s-maxage=300");
    expect(code("app/api/sounds/discovery/route.ts")).toContain("s-maxage=60");
    expect(code("app/api/tools/route.ts")).toContain("s-maxage=60");
  });
  it("teeth: the tools feed stays shareable only while it reads nothing per-user", () => {
    const t = code("app/api/tools/route.ts") + code("lib/monetization/tools.ts");
    expect(t).not.toMatch(/cookies\(|getUser\(|getClientAuthUser|createServerClient/);
  });
});
