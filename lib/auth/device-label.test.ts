import { describe, expect, it } from "vitest";

import { parseDevice } from "./device-label";

describe("parseDevice", () => {
  it("returns a fallback for a null user-agent", () => {
    expect(parseDevice(null)).toEqual({ label: "Unknown device", icon: "desktop" });
  });

  it("labels an iPhone Safari UA as a phone", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const { label, icon } = parseDevice(ua);
    expect(label).toBe("Safari on iOS");
    expect(icon).toBe("phone");
  });

  it("labels an iPad UA as a tablet, not a phone", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1";
    expect(parseDevice(ua).icon).toBe("tablet");
  });

  it("labels a desktop Chrome/Windows UA as a laptop", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const { label, icon } = parseDevice(ua);
    expect(label).toBe("Chrome on Windows");
    expect(icon).toBe("laptop");
  });

  it("distinguishes two different real browser/OS combinations", () => {
    const mac = parseDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15").label;
    const android = parseDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36").label;
    expect(mac).not.toBe(android);
  });
});
