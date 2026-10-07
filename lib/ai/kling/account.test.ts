import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classifyProbe, parseKlingPacks } from "./account";

const NOW = Date.UTC(2026, 9, 7);
const DAY = 86_400_000;

describe("Kling unit balance (live shape, 2026-10-07)", () => {
  const body = {
    code: 0,
    data: {
      resource_pack_subscribe_infos: [
        { resource_pack_name: "Trial A", resource_pack_type: "decreasing_total", total_quantity: 100, remaining_quantity: 0, invalid_time: NOW + 20 * DAY, status: "runOut" },
        { resource_pack_name: "Trial B", resource_pack_type: "decreasing_total", total_quantity: 100, remaining_quantity: 32.7, invalid_time: NOW + 29 * DAY, status: "online" },
        { resource_pack_name: "Trial C", resource_pack_type: "decreasing_total", total_quantity: 100, remaining_quantity: 100, invalid_time: NOW + 29 * DAY, status: "online" },
        { resource_pack_name: "Old", resource_pack_type: "decreasing_total", total_quantity: 50, remaining_quantity: 10, invalid_time: NOW - DAY, status: "online" },
      ],
    },
  };

  it("counts only online, unexpired packs with units left", () => {
    const r = parseKlingPacks(body, NOW)!;
    expect(r.usable.map((p) => p.name)).toEqual(["Trial C", "Trial B"]);
    expect(r.usable.reduce((s, p) => s + p.remaining, 0)).toBeCloseTo(132.7);
    expect(r.spent.map((p) => p.name).sort()).toEqual(["Old", "Trial A"]);
  });

  it("an unreadable body is null, never a fabricated zero", () => {
    expect(parseKlingPacks({ code: 0, data: {} }, NOW)).toBeNull();
    expect(parseKlingPacks(null, NOW)).toBeNull();
  });
});

describe("the connection probe verdict", () => {
  it("a validation refusal of the deliberately invalid field = the key works", () => {
    expect(classifyProbe(400, { code: 1201, message: "cfgScale: must be less than or equal to 1" })).toBe("ok");
  });
  it("401 / 1002 = a bad key", () => {
    expect(classifyProbe(401, { code: 1002 })).toBe("bad_key");
  });
  it("no answer = unreachable; a 200 (the invalid field accepted) is never ok", () => {
    expect(classifyProbe(null, null)).toBe("unreachable");
    expect(classifyProbe(200, { code: 0 })).toBe("unknown");
  });
});

describe("the probe can never bill", () => {
  const src = readFileSync(path.join(__dirname, "account.ts"), "utf8");
  it("sends an out-of-range cfg_scale (Kling caps it at 1) — a valid body would create a task", () => {
    const m = /cfg_scale:\s*(\d+(?:\.\d+)?)/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(1);
  });
  it("never calls the task-creating client", () => {
    expect(src).not.toMatch(/klingCreateTask/);
  });
});
