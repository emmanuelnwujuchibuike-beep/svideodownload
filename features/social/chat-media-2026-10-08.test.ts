import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AUDIO_MIME_CANDIDATES } from "@/lib/media/comment-recording";

/** Owner reports of 2026-10-08 — chat media, voice notes, the thread's height. */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("chat media and voice notes (2026-10-08)", () => {
  it("records voice notes as MP4/AAC first — WebM does not play back on many iPhones", () => {
    expect(AUDIO_MIME_CANDIDATES[0]).toMatch(/^audio\/mp4/);
    expect(AUDIO_MIME_CANDIDATES.indexOf("audio/mp4")).toBeLessThan(AUDIO_MIME_CANDIDATES.indexOf("audio/webm;codecs=opus"));
  });

  it("a voice note's length falls back to the recorded duration (MediaRecorder WebM says Infinity)", () => {
    const s = src("features/social/comment-media.tsx");
    expect(s).toContain("Number.isFinite(el.duration) && el.duration > 0 ? el.duration : totalMs / 1000");
    expect(s).toContain("onError={() => setFailed(true)}");
  });

  it("chat videos have no centre disc or hover tint, and both viewers keep the X below the safe area", () => {
    const s = src("features/social/comment-media.tsx");
    expect(s).not.toContain("group-hover:bg-black/30");
    expect(s).not.toContain('<span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50');
    for (const f of ["features/social/comment-media.tsx", "features/social/image-lightbox.tsx"]) {
      expect(src(f)).toContain('aria-label="Close" className="absolute right-4 top-[calc(var(--frenz-safe-top,0px)+0.75rem)]');
    }
  });

  it("the chat voice card is frameless on the bubble", () => {
    expect(src("features/social/conversation-room.tsx")).toContain('surface="bg-transparent !px-2 !pb-0.5 !pt-1" onColor={m.mine}');
  });

  it("the thread is only pinned short while a text field has focus (no stale 'keyboard' space)", () => {
    const s = src("lib/pwa/use-visual-viewport.ts");
    expect(s).toContain("if (heightGap < 80 || !editing) {");
    expect(s).toContain('document.addEventListener("focusout", onFocusChange);');
    expect(s).toContain('document.removeEventListener("focusout", onFocusChange);');
  });
});
