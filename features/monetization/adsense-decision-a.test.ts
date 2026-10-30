import { runInNewContext } from "node:vm";

import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * Decision A (owner, 2026-10-30): AdSense loads only for a visitor who is not signed in, on the public content pages —
 * never on History or Profile, never for a signed-in member. The bottom nav "is not smooth and fast anymore, especially
 * after idle": this loader pulled Google's ad chain on every public page once it went idle. The test runs the REAL inline
 * bootstrap the page ships, in a sandbox, for each kind of visit, and counts the scripts it appends.
 */
vi.mock("@/lib/monetization/settings", () => ({
  getMonetizationSettings: async () => ({ adsensePublisherId: "pub-1234567890123456", verificationTags: "" }),
  builtInAdsensePublisherId: () => "pub-1234567890123456",
}));

const { AdSenseSiteScript, adsenseLoadsFor } = await import("./adsense-site-script");

async function bootstrap(): Promise<string> {
  const tree = (await AdSenseSiteScript()) as ReactElement<{ children: ReactElement<{ dangerouslySetInnerHTML?: { __html: string } }>[] }>;
  const script = tree.props.children.find((c) => c?.props?.dangerouslySetInnerHTML);
  return script!.props.dangerouslySetInnerHTML!.__html;
}

/** Runs the bootstrap as a page would (already loaded, idle at once) and returns the script URLs it appended. */
async function visit(pathname: string, cookie: string): Promise<string[]> {
  const appended: string[] = [];
  const el = { async: false, crossOrigin: "", src: "" };
  const sandbox = {
    window: {} as Record<string, unknown>,
    document: {
      cookie,
      readyState: "complete",
      head: { appendChild: (e: { src: string }) => void appended.push(e.src) },
      documentElement: {},
      createElement: () => ({ ...el }),
    },
    location: { pathname },
    addEventListener: () => {},
    setTimeout: (f: () => void) => f(),
  };
  // requestIdleCallback runs the loader at once
  (sandbox.window as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback = (f) => f();
  runInNewContext(await bootstrap(), sandbox);
  return appended;
}

const MEMBER = "theme=dark; sb-wmimmsrtafazowjperog-auth-token=base64-eyJ...; other=1";

describe("AdSense — Decision A", () => {
  it("a visitor who is not signed in, on the landing, a platform page or the blog: it loads", async () => {
    for (const p of ["/", "/tiktok-video-downloader", "/blog/how-to-save-and-archive-your-own-tiktok-videos", "/learn/x"]) {
      const scripts = await visit(p, "theme=dark");
      expect(scripts, p).toHaveLength(1);
      expect(scripts[0], p).toContain("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456");
      expect(adsenseLoadsFor(p, "theme=dark"), p).toBe(true);
    }
  });

  it("🔴 never on History or Profile (the bottom nav's pages) — teeth: the old loader appended it everywhere", async () => {
    for (const p of ["/history", "/history/", "/profile", "/profile/settings"]) {
      expect(await visit(p, "theme=dark"), p).toEqual([]);
      expect(adsenseLoadsFor(p, ""), p).toBe(false);
    }
    // a word that merely starts the same is still a content page
    expect(await visit("/historyx", "")).toHaveLength(1);
  });

  it("🔴 never for a signed-in member, on any page", async () => {
    for (const p of ["/", "/tiktok-video-downloader", "/history"]) {
      expect(await visit(p, MEMBER), p).toEqual([]);
      expect(adsenseLoadsFor(p, MEMBER), p).toBe(false);
    }
  });

  it("the verification meta tag stays for everyone (it is not the loader)", async () => {
    const tree = (await AdSenseSiteScript()) as ReactElement<{ children: ReactElement<{ name?: string; content?: string }>[] }>;
    expect(tree.props.children.some((c) => c?.props?.name === "google-adsense-account" && c.props.content === "ca-pub-1234567890123456")).toBe(true);
  });
});
