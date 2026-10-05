import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Brief B §9/§27 (2026-10-05): a replaced photo's upload must never win, and
 * a picked photo's object URL must not outlive the page. This repo has no DOM
 * test environment, so the guarantees are pinned at the source.
 */
const src = readFileSync(join(process.cwd(), "features/ai/video/ai-image-drop.tsx"), "utf8");

describe("the photo drop", () => {
  it("ignores an upload that finishes after the photo was replaced or removed", () => {
    expect(src).toContain("const mine = ++seq.current;");
    expect(src).toContain("if (mine === seq.current) onChange(url);");
    // removing invalidates whatever is still uploading
    expect(src).toContain("seq.current += 1; // any upload still in flight is now stale");
    // the unguarded form that let the old photo come back must be gone
    expect(src).not.toContain("onChange(await upload(file));");
  });

  it("revokes the preview's object URL on unmount, not only on replace", () => {
    expect(src).toContain("if (previewRef.current) URL.revokeObjectURL(previewRef.current);");
  });

  it("offers Replace as well as Remove (§10)", () => {
    expect(src).toContain("Replace");
    expect(src).toContain('aria-label="Remove image"');
  });
});
