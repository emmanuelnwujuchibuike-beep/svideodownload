import { describe, expect, it } from "vitest";

import { classifyInstallPlatform } from "./platform";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("classifyInstallPlatform", () => {
  it("passes ios and ios-inapp through unchanged, ignoring the UA", () => {
    expect(classifyInstallPlatform("ios", DESKTOP_UA)).toBe("ios");
    expect(classifyInstallPlatform("ios-inapp", ANDROID_UA)).toBe("ios-inapp");
  });

  it("classifies android mode as android on an Android UA", () => {
    expect(classifyInstallPlatform("android", ANDROID_UA)).toBe("android");
  });

  it("classifies android mode as desktop on a non-Android UA (same beforeinstallprompt event)", () => {
    expect(classifyInstallPlatform("android", DESKTOP_UA)).toBe("desktop");
  });
});
