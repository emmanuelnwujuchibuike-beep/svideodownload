import { afterEach, describe, expect, it, vi } from "vitest";

import { readCookie, readCookieJar, writeCookie } from "./cookie";

/**
 * `document.cookie` THROWS inside a sandboxed embed — AdSense's site preview
 * rendered our root-layout error boundary because of it (2026-09-13). These
 * pin the one property that matters: no read or write here ever throws, and
 * a forbidden jar reads as an empty one.
 */
describe("lib/dom/cookie — a forbidden jar is an empty jar, never an exception", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDocument(jar: { get?: () => string; set?: (v: string) => void }) {
    const doc = {};
    Object.defineProperty(doc, "cookie", {
      configurable: true,
      get: jar.get ?? (() => ""),
      set: jar.set ?? (() => {}),
    });
    vi.stubGlobal("document", doc);
  }

  it("reads a value out of a normal jar", () => {
    stubDocument({ get: () => "a=1; frenz_lang=fr; b=2" });
    expect(readCookie("frenz_lang")).toBe("fr");
    expect(readCookieJar()).toContain("frenz_lang=fr");
  });

  it("🔴 returns an empty jar / null when the read throws a SecurityError", () => {
    stubDocument({
      get: () => {
        throw new DOMException("The document is sandboxed and lacks the 'allow-same-origin' flag.", "SecurityError");
      },
    });
    expect(readCookieJar()).toBe("");
    expect(readCookie("frenz_lang")).toBeNull();
  });

  it("🔴 reports a refused write as false instead of throwing", () => {
    stubDocument({
      set: () => {
        throw new DOMException("sandboxed", "SecurityError");
      },
    });
    expect(writeCookie("x=1; path=/")).toBe(false);
  });

  it("reports an accepted write as true", () => {
    let written = "";
    stubDocument({ set: (v) => void (written = v) });
    expect(writeCookie("x=1; path=/")).toBe(true);
    expect(written).toBe("x=1; path=/");
  });

  it("decodes a percent-encoded value and survives one that is not valid encoding", () => {
    stubDocument({ get: () => "frenz_mode=full%20bleed; bad=%E0%A4%A" });
    expect(readCookie("frenz_mode")).toBe("full bleed");
    expect(readCookie("bad")).toBe("%E0%A4%A");
  });

  it("is null, not '', for a cookie that is absent", () => {
    stubDocument({ get: () => "other=1" });
    expect(readCookie("frenz_lang")).toBeNull();
  });
});
