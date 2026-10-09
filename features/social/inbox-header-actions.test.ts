import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-08: the Messages header's add-friend button opens the MAIN
 * Friends page; the circles are more premium, glassy and a bit bolder but
 * light; and they respond instantly, like the Earn button.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const header = code("features/social/inbox-header-actions.tsx");
const css = code("app/globals.css");

/** The press shows on finger-DOWN for every circle — a function so the teeth can run it on a broken stylesheet. */
const pressesOnDown = (sheet: string) => sheet.includes(".frenz-inbox-action:active,\n  .frenz-inbox-action[data-pending] {\n    transform: scale(0.9);");

describe("inbox header actions", () => {
  it("Add friends goes to /friends through the go-once link Earn uses, with no spinner pushing the icon off-centre", () => {
    expect(header).toMatch(/<TapOnceLink\s+href="\/friends"\s+spinner=\{false\}/);
    expect(header).not.toContain("SuggestionsLauncher");
  });
  it("all three circles share one class; a bolder stroke; no animation library on the trigger", () => {
    expect(header).toContain('const CIRCLE = "frenz-inbox-action flex h-9 w-9 items-center justify-center rounded-full text-foreground min-[360px]:h-10 min-[360px]:w-10";');
    expect(header).toContain("<ComposeLauncher className={CIRCLE} iconClassName={ICON} strokeWidth={STROKE} />");
    expect(header).not.toContain("whileTap");
  });
  it("presses on finger-down and stays pressed while the page is on its way", () => {
    expect(pressesOnDown(css)).toBe(true);
    expect(pressesOnDown(css.replace(".frenz-inbox-action:active,\n", ""))).toBe(false);
  });
  it("compose starts its people list on finger-down, one request however it started", () => {
    const c = code("features/social/compose-launcher.tsx");
    expect(c).toContain("onPointerDown={primePeople}");
    expect(c).toContain("if (people || peopleLoad.current) return;");
  });
});
