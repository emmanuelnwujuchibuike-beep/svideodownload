import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isAvatarReady, StableAvatar, warmAvatars } from "./stable-avatar";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

class FakeImage {
  decoding = "auto";
  src = "";
  decode() {
    return this.src.includes("broken") ? Promise.reject(new Error("bad")) : Promise.resolve();
  }
}

afterEach(() => vi.unstubAllGlobals());

// owner, 2026-10-09: "make the top and chat avatar to never reload on backswipe unneccessarily"
describe("StableAvatar: a seen avatar paints in the frame it mounts", () => {
  it("an unseen URL decodes async; once decoded, the next mount is sync", async () => {
    vi.stubGlobal("Image", FakeImage);
    const url = "https://cdn.example/a.webp";
    expect(renderToStaticMarkup(<StableAvatar src={url} />)).toContain('decoding="async"');
    warmAvatars([url, url, null, ""]);
    await Promise.resolve();
    await Promise.resolve();
    expect(isAvatarReady(url)).toBe(true);
    expect(renderToStaticMarkup(<StableAvatar src={url} />)).toContain('decoding="sync"');
  });

  it("a broken avatar is never marked ready", async () => {
    vi.stubGlobal("Image", FakeImage);
    warmAvatars(["https://cdn.example/broken.webp"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(isAvatarReady("https://cdn.example/broken.webp")).toBe(false);
  });

  it("the inbox rows and the header avatar use it — no bare <img> left", () => {
    const list = src("features/social/conversation-list.tsx");
    expect(list.match(/<StableAvatar/g)?.length).toBeGreaterThanOrEqual(3);
    expect(list).toContain("warmAvatars(");
    const menu = src("features/auth/user-menu.tsx");
    expect(menu).not.toMatch(/<img\s/);
    expect(menu.match(/<StableAvatar/g)).toHaveLength(3);
  });
});

describe("the inbox does not refetch on a back-swipe — but typing stays live", () => {
  it("a warm inbox skips the mount fetch; a cold one still loads", () => {
    expect(src("features/social/conversation-list.tsx")).toMatch(/revalidateOnFocus: false,\s*revalidateOnMount: false,/);
    const q = src("features/data/use-query.ts");
    expect(q).toContain("if (revalidateOnMount || !warm) void refetch()");
    expect(q).toContain("revalidateOnMount = true");
  });

  // owner, 2026-10-09: "the typing indicator needs validating each time chat start but that shouldnt cause the reload"
  it("each row still subscribes to typing on mount, independent of the inbox fetch", () => {
    const list = src("features/social/conversation-list.tsx");
    expect(list).toContain('useTypingIndicator(subscribeTyping ? c.id : "", viewerId, "", false)');
  });
});
