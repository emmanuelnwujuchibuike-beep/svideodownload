import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 2026-10-06, measured on production: opening /u/chris downloaded 68 MB of MP4
 * with nobody pressing play. A video used as a still (`#t=…` + preload
 * "metadata") pulls most of a file whose index sits at the end, and an intro
 * clip was fetched twice (streamed AND re-fetched to cache). None of it was
 * Vercel — it was the visitor's data and Supabase/R2 egress.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a still is never a video download", () => {
  it("a profile/feed grid tile renders no <video>", () => {
    const grid = read("components/social/post-grid.tsx");
    expect(grid).not.toMatch(/^\s*<video\b/m); // JSX, not the comment that explains why
    expect(grid).not.toContain("#t=0.5");
  });

  it("a story circle uses the story thumbnail, never the video", () => {
    expect(read("features/friends/friends-stories.tsx")).not.toMatch(/<video src=\{`\$\{cover\.mediaUrl\}#t=/);
  });

  it("a trending reel preview loads nothing until it is on screen", () => {
    expect(read("features/app-shell/dashboard/trending-reels.tsx")).toContain('preload="none"');
  });

  it("the profile intro video downloads once, then plays from that copy", () => {
    const v = read("features/profile/identity-video.tsx");
    expect(v).toContain("applyBlob(blob);");
    // the old shape: start streaming, THEN fetch the same file again in the background
    expect(v).not.toMatch(/setVideoSrc\(src\);\n\s*const \{ saveData, effectiveType \} = getSyncConditions\(\);/);
  });
});

describe("every new video gets a cover (2026-10-06: 4 posts had none)", () => {
  it("the capture seeks on metadata — iOS never fires loadeddata for preload=metadata", () => {
    const p = read("lib/media/video-poster.ts");
    expect(p).toContain("video.onloadedmetadata = seek;");
    expect(p).toContain("12_000");
  });

  it("both publish paths retry the cover upload once", () => {
    for (const f of ["features/create/upload-ahead.ts", "features/create/composer-core.ts"]) {
      expect(read(f), f).toContain(".catch(() => putPoster(");
    }
  });
});
