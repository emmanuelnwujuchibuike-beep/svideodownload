import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Monetag direct link opens in a NEW tab (owner, 2026-10-16: "it should open another tab so users
 * can still return where they stop") — and still does where the pop-under guard is installed, which
 * refuses every window.open that wasn't announced (it used to refuse this one too, silently).
 */

const nativeOpen = vi.fn(() => ({}) as Window);
const store = new Map<string, string>();
vi.stubGlobal("window", { open: nativeOpen });
vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
vi.mock("@/lib/monetization/ads-config-client", () => ({
  loadAdsConfig: async () => ({ monetagDirectLink: { url: "https://example-direct.link/abc", spots: ["wallpaper"], chancePercent: 100 } }),
}));

const guard = await import("@/lib/monetization/popunder-guard");
const { loadDirectLinkOpener } = await import("./direct-link-runtime");

beforeEach(() => {
  store.clear();
  nativeOpen.mockClear();
  guard.__resetPopunderGuard();
});

describe("Monetag direct link", () => {
  it("opens a new tab (never this one), even with the pop-under guard installed", async () => {
    guard.installPopunderGuard();
    const open = await loadDirectLinkOpener("wallpaper");
    expect(open).toBeTypeOf("function");
    open!();
    expect(nativeOpen).toHaveBeenCalledTimes(1);
    expect(nativeOpen).toHaveBeenCalledWith("https://example-direct.link/abc", "_blank", "noopener,noreferrer");
    expect(guard.popunderGuardStats()).toMatchObject({ allowed: 1, blocked: 0 });
  });

  it("the guard still refuses an open nobody announced (a third-party pop-under)", () => {
    guard.installPopunderGuard();
    expect(window.open("https://popunder.example/", "_blank")).toBeNull();
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it("once per session per spot", async () => {
    guard.installPopunderGuard();
    const open = await loadDirectLinkOpener("wallpaper");
    open!();
    open!();
    expect(nativeOpen).toHaveBeenCalledTimes(1);
  });
});
