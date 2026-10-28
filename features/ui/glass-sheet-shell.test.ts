import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("features/ui/glass-sheet-shell.tsx", "utf8");

describe("GlassSheetShell keeps focus where the member is typing", () => {
  it("🔴 its open effect runs on `open` only — an inline onClose re-ran it per keystroke and dropped the keyboard (2026-10-28)", () => {
    expect(src).toContain("}, [open]);");
    expect(src).not.toContain("}, [open, onClose]);");
  });
  it("never pulls focus off a field already inside the panel", () => {
    expect(src).toContain("!panel.contains(document.activeElement)");
  });
});
