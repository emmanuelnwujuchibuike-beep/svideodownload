import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { publicDirectLink } from "./direct-link";
import { resolveMonetagTags, type MonetagUnit } from "./monetag";

/*
  Owner, 2026-10-16: "Why is Monetag showing in page push and all when I turned off every other
  except the direct link … and if I turn off monetag main switch the direct link will not work".
  The Multitag serves every format enabled in the Monetag dashboard and had no switch of its own.
*/
const TAG = '<script src="//foo.monetag.com/tag.min.js" data-zone="1234567" data-cfasync="false"></script>';
const PUSH = '<script src="//bar.monetag.com/ipp.js" data-zone="7654321"></script>';
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("the Multitag's own switch", () => {
  const offUnits: MonetagUnit[] = [{ type: "in_page_push", snippet: PUSH, enabled: false } as MonetagUnit];

  it("before the fix's switch exists (older rows): the Multitag still loads — no silent change", () => {
    expect(resolveMonetagTags({ monetag: true, monetagSnippet: TAG, monetagUnits: offUnits }).map((t) => t.type)).toEqual(["multitag"]);
  });
  it("Multitag OFF + every unit off: NOTHING site-wide loads, with the master switch still on", () => {
    expect(resolveMonetagTags({ monetag: true, monetagSnippet: TAG, monetagMultitagEnabled: false, monetagUnits: offUnits })).toEqual([]);
  });
  it("…and the direct link still opens, because the master switch is on", () => {
    expect(publicDirectLink({ enabled: true, url: "https://uplcm.com/4/11476379", spots: { wallpaper_download: true }, chancePercent: 50 }, true)).not.toBeNull();
  });
  it("Multitag OFF leaves a switched-on per-type unit running", () => {
    const tags = resolveMonetagTags({ monetag: true, monetagSnippet: TAG, monetagMultitagEnabled: false, monetagUnits: [{ type: "in_page_push", snippet: PUSH, enabled: true } as MonetagUnit] });
    expect(tags.map((t) => t.type)).toEqual(["in_page_push"]);
  });
  it("the setting is saved, defaults on, and the admin has the switch", () => {
    expect(code("app/api/admin/monetization/route.ts")).toContain("monetagMultitagEnabled: z.boolean().default(true),");
    expect(code("lib/monetization/settings.ts")).toContain("monetagMultitagEnabled: true,");
    expect(code("features/admin/monetization-settings.tsx")).toContain("<Switch on={state.monetagMultitagEnabled} />");
  });
});
