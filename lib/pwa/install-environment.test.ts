import { describe, expect, it } from "vitest";

import {
  detectBrowser,
  detectForm,
  detectInApp,
  detectOs,
  describeEnvironment,
  installGuide,
} from "./install-environment";

/**
 * The browser matrix, pinned.
 *
 * Every Chromium browser's UA also contains "Chrome", and most also contain
 * "Safari" — so `detectBrowser` is entirely a question of ordering, and an
 * ordering bug is invisible by inspection. These are real user-agent strings;
 * the assertions are the whole point of having parameterised the functions on
 * the UA rather than reading `navigator` inside them.
 */

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/123.0 Mobile/15E148 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  androidEdge:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 EdgA/122.0",
  androidOpera:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 OPR/79.0",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:123.0) Gecko/123.0 Firefox/123.0",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  desktopEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 322.0.0.29.111",
  facebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]",
  tiktok:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36 musical_ly_2022803040 BytedanceWebview/d8a21c6",
};

describe("detectBrowser", () => {
  it("picks the specific Chromium fork over the generic Chrome token", () => {
    // Each of these UAs also contains "Chrome" and "Safari"; ordering decides.
    expect(detectBrowser(UA.androidSamsung)).toBe("samsung");
    expect(detectBrowser(UA.androidEdge)).toBe("edge");
    expect(detectBrowser(UA.desktopEdge)).toBe("edge");
    expect(detectBrowser(UA.androidOpera)).toBe("opera");
  });

  it("identifies plain Chrome on both platforms", () => {
    expect(detectBrowser(UA.androidChrome)).toBe("chrome");
    expect(detectBrowser(UA.desktopChrome)).toBe("chrome");
    expect(detectBrowser(UA.iphoneChrome)).toBe("chrome");
  });

  it("identifies real Safari, which says Safari without saying Chrome", () => {
    expect(detectBrowser(UA.iphoneSafari)).toBe("safari");
    expect(detectBrowser(UA.macSafari)).toBe("safari");
  });

  it("identifies Firefox on both its UA shapes", () => {
    expect(detectBrowser(UA.androidFirefox)).toBe("firefox");
    expect(detectBrowser(UA.iphoneFirefox)).toBe("firefox");
  });

  it("reports Brave from the capability, since its UA is Chrome's", () => {
    expect(detectBrowser(UA.desktopChrome, true)).toBe("brave");
  });

  it("classifies embedded webviews ahead of everything else", () => {
    expect(detectBrowser(UA.instagram)).toBe("inapp");
    expect(detectBrowser(UA.facebook)).toBe("inapp");
    expect(detectBrowser(UA.tiktok)).toBe("inapp");
  });
});

describe("detectOs", () => {
  it("reads iOS, Android and the desktops", () => {
    expect(detectOs(UA.iphoneSafari)).toBe("ios");
    expect(detectOs(UA.androidChrome)).toBe("android");
    expect(detectOs(UA.desktopChrome, "Win32")).toBe("windows");
    expect(detectOs(UA.macSafari, "MacIntel")).toBe("macos");
  });

  it("treats a touch MacIntel as iPadOS, which lies about being a Mac", () => {
    // iPadOS 13+ reports the desktop Safari UA and platform; touch points are
    // the only signal that separates it from a real Mac.
    expect(detectOs(UA.macSafari, "MacIntel", 5)).toBe("ios");
    expect(detectOs(UA.macSafari, "MacIntel", 0)).toBe("macos");
  });
});

describe("detectForm", () => {
  it("separates phone, tablet and desktop", () => {
    expect(detectForm(UA.iphoneSafari, "ios")).toBe("mobile");
    expect(detectForm(UA.macSafari, "ios", 5)).toBe("tablet");
    expect(detectForm(UA.androidChrome, "android")).toBe("mobile");
    expect(detectForm(UA.desktopChrome, "windows")).toBe("desktop");
  });
});

describe("detectInApp", () => {
  it("names the host app so the copy can be specific", () => {
    expect(detectInApp(UA.instagram)).toBe("Instagram");
    expect(detectInApp(UA.facebook)).toBe("Facebook");
    expect(detectInApp(UA.tiktok)).toBe("TikTok");
    expect(detectInApp(UA.iphoneSafari)).toBeNull();
  });
});

describe("installGuide", () => {
  it("gives every iOS browser the same share-sheet steps, named for that browser", () => {
    // Apple requires every iOS browser to be WebKit, so Chrome and Firefox for
    // iOS reach Add to Home Screen through the identical OS share sheet.
    for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.iphoneFirefox]) {
      const guide = installGuide(describeEnvironment(ua));
      expect(guide.steps.join(" ")).toMatch(/Add to Home Screen/i);
    }
    expect(installGuide(describeEnvironment(UA.iphoneChrome)).steps[0]).toMatch(/Chrome/);
    expect(installGuide(describeEnvironment(UA.iphoneSafari)).steps[0]).toMatch(/Safari/);
  });

  it("is honest that Firefox desktop cannot install a web app", () => {
    const guide = installGuide(describeEnvironment(UA.desktopChrome.replace(/Chrome\/122\.0\.0\.0 /, "Firefox/123.0 ")));
    expect(guide.steps.join(" ")).toMatch(/doesn't install web apps|Chrome, Edge or Brave/i);
  });

  it("tells in-app browser users to leave, rather than giving steps that cannot work", () => {
    const guide = installGuide(describeEnvironment(UA.instagram));
    expect(guide.title).toMatch(/Open Frenz in your browser/i);
    expect(guide.note).toMatch(/Instagram/);
  });

  it("names the right menu for Samsung Internet", () => {
    expect(installGuide(describeEnvironment(UA.androidSamsung)).steps.join(" ")).toMatch(/Samsung Internet/);
  });

  it("always returns at least one actionable step", () => {
    for (const ua of Object.values(UA)) {
      expect(installGuide(describeEnvironment(ua)).steps.length).toBeGreaterThan(0);
    }
  });
});

describe("describeEnvironment", () => {
  it("labels the environment the way the modal shows it", () => {
    expect(describeEnvironment(UA.iphoneSafari).label).toBe("Safari on iPhone");
    expect(describeEnvironment(UA.androidChrome).label).toBe("Chrome on Android");
    expect(describeEnvironment(UA.desktopChrome, "Win32").label).toBe("Chrome on Windows");
    expect(describeEnvironment(UA.instagram).label).toBe("Instagram's in-app browser");
  });
});
