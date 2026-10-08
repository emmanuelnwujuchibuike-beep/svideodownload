import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Owner, 2026-10-08: a Lip Sync item in Frenz AI → History showed "something went wrong". */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("AI History opens each tool on the page's own door", () => {
  it("Lip Sync, Voice Cloning and Text to Audio links come from aiBase, not from the studio Character Replace URL", () => {
    const h = src("features/ai/frenz-ai-history.tsx");
    expect(h).toContain("router.push(`${aiBase}/lip-sync/result/${encodeURIComponent(job.id)}`);");
    expect(h).toContain("router.push(`${aiBase}/voice-cloning?job=${encodeURIComponent(job.id)}`);");
    expect(h).toContain("router.push(`${aiBase}/text-to-audio?job=${encodeURIComponent(job.id)}`);");
    expect(h).not.toContain('.replace("/character-replace/result/", "/lip-sync/result/")');
  });

  it("each history page passes its own base", () => {
    expect(src("features/ai/frenz-ai-history-page.tsx")).toContain("aiBase={base}");
    expect(src("app/(marketing)/ai/history/page.tsx")).toContain('base="/ai"');
    expect(src("app/(app)/studio/ai/history/page.tsx")).toContain('base="/studio/ai"');
  });
});
