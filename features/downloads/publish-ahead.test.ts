import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-27: "make publish to everyone from Download go faster like an upload from feed". The feed's head
 * start (features/create/upload-ahead.ts) now runs for a downloaded video too: it begins when the ••• sheet opens,
 * Publish waits only for what is left, and an upload nobody published is cancelled. Read from the source — the
 * upload job itself is pinned with the feed composer.
 */
const src = readFileSync("features/downloads/download-player.tsx", "utf8");

describe("Publish to everyone from Downloads uses the feed's upload head start", () => {
  it("the upload starts when the options sheet opens — a video, signed in, not on a slow connection", () => {
    expect(src).toMatch(/if \(!moreOpen \|\| postId \|\| rec\.kind !== "video" \|\| isSlowConnection\(\)\) return;/);
    expect(src).toMatch(/if \(data\.user\) startUploadAhead\(aheadId, file\);/);
  });
  it("Publish waits for that job (with its percentage) before falling back to the ordinary upload", () => {
    const at = src.indexOf("const ahead = getUploadAhead(aheadId);");
    const fallback = src.indexOf("const prefetched = planRef.current;");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(fallback);
    expect(src).toMatch(/Publishing for everyone… \$\{pct\}%/);
    expect(src).toMatch(/thumbnailUrl: posterUrl \?\? rec\.thumbnail/);
  });
  it("an upload nobody published is cancelled when the player closes", () => {
    expect(src).toMatch(/useEffect\(\(\) => \(\) => cancelUploadAhead\(aheadId\), \[aheadId\]\);/);
  });
});
