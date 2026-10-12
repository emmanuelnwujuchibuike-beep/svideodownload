import { describe, expect, it } from "vitest";

import { deviceName } from "./device-name";

describe("deviceName (Part 6 device manager)", () => {
  it("names common devices", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toEqual({ name: "iPhone · Safari", platform: "ios" });
    expect(deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36").name).toBe("Android phone · Chrome");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0").name).toBe("Windows · Edge");
  });
  it("an unknown or missing agent is just 'Device'", () => {
    expect(deviceName(null)).toEqual({ name: "Device", platform: "other" });
  });
});
