import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WORKSPACE_STEPS } from "./workspace";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 9 — premium UX, pinned where a regression would be silent
 * ═══════════════════════════════════════════════════════════════════════════
 */

describe("a per-member API answer is never cached (found on production, 2026-09-14)", () => {
  it("every AI, admin and internal route carries no-store from the origin, and the AI clients refuse a cached answer", () => {
    const cfg = src("next.config.ts");
    expect(cfg).toContain('source: "/api/:group(ai|admin|internal)/:path*",');
    expect(cfg).toContain('headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],');
    for (const f of ["lib/ai/client.ts", "lib/ai/character-replace/client.ts"]) expect(code(f)).toContain('res = await fetch(input, { cache: "no-store", ...init });');
  });
});

describe("nothing floats over the workspace's action bar", () => {
  it("the push nudge and the desktop Messages pill stay off /studio/ai/character-replace", () => {
    expect(code("features/notifications/push-nudge.tsx")).toContain('if ((pathname ?? "").startsWith("/studio/ai/character-replace")) return;');
    expect(code("features/app-shell/floating-messages.tsx")).toContain('if (pathname.startsWith("/studio/ai/character-replace")) return null;');
  });
});

describe("the words a first-time user reads", () => {
  it("steps are Character → Video → Quality → Voice → Review", () => {
    expect(WORKSPACE_STEPS.map((s) => s.label)).toEqual(["Character", "Video", "Quality", "Voice", "Review"]);
  });
  it("no provider or model name on the entry card, the workspace or the result", () => {
    for (const f of ["features/ai/character-replace/character-replace-entry.tsx", "features/ai/character-replace/step-settings.tsx", "features/ai/character-replace/step-voice.tsx", "features/ai/character-replace/result.tsx", "features/ai/character-replace/processing.tsx"]) {
      expect(code(f), f).not.toMatch(/Wan 2\.2|xrunda|prunaai|lipsync-2|minimax|replicate/i);
    }
  });
  it("the primary button names the action and the price; short of balance it recharges instead of failing", () => {
    const ws = code("features/ai/character-replace/character-replace-workspace.tsx");
    expect(ws).toContain("`Create Video · ${formatCents(quotedTotal.totalCents, quotedTotal.symbol)}`");
    expect(ws).toContain("Recharge to continue");
    expect(ws).toContain("const shortOfBalance = !!quotedTotal && balanceKnown !== null && balanceKnown < quotedTotal.totalCents;");
    expect(ws).not.toMatch(/>\s*Start\s*</);
  });
  it("one Recommended badge per choice group; premium lip sync is called that", () => {
    const settings = code("features/ai/character-replace/step-settings.tsx");
    expect(settings).toContain('const recommended = offered && q.id === recommendedId;');
    expect(settings).toContain("Recommended");
    const voice = code("features/ai/character-replace/step-voice.tsx");
    expect(voice).toContain('badge="Recommended"');
    expect(voice).toContain('title="Keep original audio"');
    expect(voice).toContain("Premium");
    expect(voice).not.toContain(">Studio<");
  });
  it("consent is one sentence with the why on request; the disclosure is honest, never 'undetectable'", () => {
    const review = src("features/ai/character-replace/step-review.tsx");
    expect(review).toContain("I confirm that I have permission to use this");
    expect(review).toContain("What this means");
    const result = src("features/ai/character-replace/result.tsx");
    expect(result).toContain("AI-generated transformation · made with Frenz AI");
    for (const f of ["features/ai/character-replace/result.tsx", "features/ai/character-replace/character-replace-entry.tsx"]) expect(src(f)).not.toMatch(/undetectable|100% perfect|exactly like real life/i);
  });
});

describe("price, trim and progress are the server's facts (§6, §12, §15)", () => {
  it("the price card prints the quote's own lines — nothing multiplies in the browser", () => {
    const card = code("features/ai/character-replace/video-generation-cost-preview.tsx");
    expect(card).toContain("snapshot.rateLine");
    expect(card).toContain("formatCents(snapshot.totalCents, sym)");
    expect(card).toContain('label={after < 0 ? "Short by" : "Balance after"}');
    expect(card).not.toMatch(/durationMs\s*\*|\*\s*qualityRateCents|perSecondCents\s*\*/);
    // the settings step shows one price card, not two
    const settings = code("features/ai/character-replace/step-settings.tsx");
    expect(settings).not.toContain("CharacterReplaceInputSummary");
    expect(settings.match(/<VideoGenerationCostPreview/g)?.length).toBe(1);
  });
  it("the trimmer plays the kept range only and bills nothing on its own", () => {
    const settings = code("features/ai/character-replace/step-settings.tsx");
    expect(settings).toContain("if (el.currentTime < start || el.currentTime >= end - 0.05) el.currentTime = start;");
    expect(settings).toContain("if (!el.paused && el.currentTime >= end) {");
    expect(settings).toContain("{formatClock(start)} – {formatClock(end)}");
    expect(settings).not.toMatch(/onTrim\([^)]*now/);
  });
  it("progress is one segment per real stage, never a percentage", () => {
    const p = code("features/ai/character-replace/processing.tsx");
    expect(p).toContain('aria-label="Progress by stage"');
    expect(p).toContain("steps.filter((s) => s.state === \"done\").length");
    expect(p).not.toMatch(/Math\.round\([^)]*\* 100\)%|\{percent\}/);
    expect(p).toContain('return "Starting";');
  });
});

describe("the empty history is a door, and a tile says what it holds (§24, §35)", () => {
  it("empty → Create a video; a ready tile → length · quality · when", () => {
    const h = src("features/ai/frenz-ai-history.tsx");
    expect(h).toContain('<Link href="/studio/ai/character-replace" className="btn-lux mt-5 bg-foreground text-background">');
    expect(h).toContain("qualityWord(cr.quality)");
    expect(src("lib/ai/history.ts")).toContain('title: "Your transformations will appear here",');
  });
});

describe("the admin price set-up is one number per row (owner, 2026-09-14)", () => {
  it("shows a per-second field for every replacement type and quality, saves it as that quality's own rate, and no longer asks for a base rate or multiplier", () => {
    const panel = src("features/admin/character-replace-pricing.tsx");
    expect(panel).toContain('<Group title="Price per second">');
    expect(panel).toContain("<th className=\"py-2 pr-3\">Members pay, per second</th>");
    expect(panel).toContain("<th className=\"py-2 pr-3\">10-second video</th>");
    expect(panel).toContain("perSecond: minorToMajorInput(q.perSecondCents ?? Math.ceil(cr.pricePerSecondCents * q.multiplier)),");
    expect(panel).toContain("useOwnRate: true,");
    expect(panel).not.toContain('label="Base rate per second"');
    expect(panel).not.toContain('label="Multiplier"');
    expect(panel).not.toContain("Own rate instead");
    // the engine is untouched: an own rate still wins over base × multiplier
    const pricing = src("lib/ai/character-replace/pricing.ts");
    expect(pricing).toMatch(/perSecondCents\s*\?\?|perSecondCents !== null|perSecondCents ?: /);
  });
});
