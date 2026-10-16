import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Owner, 2026-10-16: "opening ad link shouldn't close the frenzsave tab, it should open another
  tab so users can still return where they stop". A minimal browser stand-in: what matters is
  whether THIS tab is ever navigated, and what kind of link is clicked.
*/

vi.mock("../ad-events-client", () => ({ trackAdEvent: vi.fn() }));

const assign = vi.fn();
const clicked: { href: string; target: string; rel: string }[] = [];
let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign.mockClear();
  clicked.length = 0;
  // the HTML spec: with "noopener", window.open returns null even though the tab opened
  windowOpen = vi.fn(() => null);
  const body = { appendChild: vi.fn() };
  vi.stubGlobal("window", { open: windowOpen, location: { assign } });
  vi.stubGlobal("document", {
    body,
    createElement: () => {
      const a = { href: "", target: "", rel: "", style: {} as Record<string, string>, click: () => clicked.push({ href: a.href, target: a.target, rel: a.rel }), remove: vi.fn() };
      return a;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const { openAdInNewTab, visitAd } = await import("./ad-detail-store");
const ad = { c: "c", cr: "cr", url: "https://advertiser.example/landing" } as never;

describe("an ad's link opens in a NEW tab and never moves this one", () => {
  it("the old pattern took THIS tab away every time (the defect, reproduced)", () => {
    const w = window.open("https://advertiser.example/landing", "_blank", "noopener,noreferrer");
    if (!w) window.location.assign("https://advertiser.example/landing");
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("visitAd clicks a target=_blank, noopener link and never navigates this tab", () => {
    visitAd(ad, null);
    expect(clicked).toEqual([{ href: "https://advertiser.example/landing", target: "_blank", rel: "noopener noreferrer sponsored" }]);
    expect(assign).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("the helper used by the details sheet behaves the same", () => {
    openAdInNewTab("https://advertiser.example/x");
    expect(clicked[0]).toMatchObject({ target: "_blank" });
    expect(assign).not.toHaveBeenCalled();
  });
});
