import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { announcementHiddenOn } from "@/features/announcements/hidden-paths";

describe("the announcement bar stays off the Messages inbox and chats (owner, 2026-10-18)", () => {
  it("hides on /messages and everything under it", () => {
    for (const p of ["/messages", "/messages/", "/messages/3f2a", "/messages/new", "/messages/secret"]) expect(announcementHiddenOn(p), p).toBe(true);
  });

  it("teeth: every other page keeps it, including look-alike paths", () => {
    for (const p of ["/", "/downloads", "/home", "/feed", "/exclusive", "/messages-archive", "/account/messages", null, undefined, ""]) expect(announcementHiddenOn(p), String(p)).toBe(false);
  });

  it("the banner actually applies the rule (so it also resets the reserved height)", () => {
    const src = readFileSync(join(process.cwd(), "features/announcements/announcement-banner.tsx"), "utf8");
    expect(src).toContain("const onPath = !announcementHiddenOn(pathname) &&");
  });
});
