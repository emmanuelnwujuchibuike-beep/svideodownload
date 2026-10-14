import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-14: "users should be able to close this chat option by tapping
 * on the chat background". The message menu is portaled to <body>; on a phone
 * the thread is `fixed z-50`, so the menu's backdrop must sit above 50 or every
 * tap lands on the thread instead.
 */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

const zOf = (cls: string) => {
  const m = cls.match(/\bz-(?:\[(\d+)\]|(\d+))/);
  return m ? Number(m[1] ?? m[2]) : NaN;
};

describe("the message menu closes on a tap on the chat", () => {
  it("🔴 its backdrop sits above the mobile thread layer", () => {
    const thread = code("app/(app)/messages/[id]/page.tsx").match(/className="thread-enter fixed inset-0 (z-\S+)/)?.[1] ?? "";
    const room = code("features/social/conversation-room.tsx");
    const backdrop = room.match(/onPointerDown=\{\(\) => setOpenMenuId\(null\)\}[\s\S]*?className="fixed inset-0 (z-\S+) cursor-default"/)?.[1] ?? "";
    expect(zOf(thread)).toBeGreaterThan(0);
    expect(zOf(backdrop)).toBeGreaterThan(zOf(thread));
    expect(zOf(backdrop)).toBeLessThan(100); // under the toasts
  });
});
