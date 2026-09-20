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

describe("a per-member API answer is never cached (found on production, 2026-09-14; widened to every API route 2026-09-20)", () => {
  /*
    The rule in next.config.ts OVERRIDES a handler's own Cache-Control
    (measured on `next start`, 2026-09-20), so the routes that cache on
    purpose are carved out of it by name. This test runs Next's own compiled
    path matcher over the rule: the AI, admin and a header-less route must
    match (no-store), and EVERY route under app/api that sets a positive
    max-age must NOT — a new deliberately-cached route that is not added to
    the carve-out would silently lose its caching, and this is what notices.
  */
  const rule = () => {
    const cfg = src("next.config.ts");
    const m = /source:\s*\n?\s*"(\/api\/:path\(\(\?!.*?\)\.\*\))",\s*\n\s*headers: \[\{ key: "Cache-Control", value: "private, no-store, max-age=0" \}\]/s.exec(cfg);
    if (!m) throw new Error("the wide no-store rule is gone from next.config.ts");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (p: string) => RegExp };
    return pathToRegexp(m[1] ?? "");
  };
  it("the AI, admin and internal routes — and any header-less route — are no-store from the origin, and the AI clients refuse a cached answer", () => {
    const re = rule();
    for (const p of ["/api/ai/jobs/abc", "/api/ai/character-replace/balance", "/api/admin/activity", "/api/internal/x", "/api/health", "/api/profile/u", "/api/flagsx"]) {
      expect(re.test(p), p).toBe(true);
    }
    for (const f of ["lib/ai/client.ts", "lib/ai/character-replace/client.ts"]) expect(code(f)).toContain('res = await fetch(input, { cache: "no-store", ...init });');
  });
  it("every route that caches on purpose is carved out of the rule and keeps its own header", () => {
    const re = rule();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (name === "route.ts") out.push(full);
      }
      return out;
    };
    const deliberate: string[] = [];
    for (const file of walk(join(process.cwd(), "app", "api"))) {
      const body = code(file.slice(process.cwd().length + 1));
      // a positive max-age / s-maxage / immutable on a line that is not itself no-store
      const caches = body.split("\n").some((l) => /cache-control/i.test(l) && !/no-store|no-cache/i.test(l) && /max-age=[1-9]|s-maxage=[1-9]|immutable|IMMUTABLE/.test(l));
      if (!caches) continue;
      const rel = file.slice(process.cwd().length + 1).replace(/\\/g, "/").replace(/^app/, "").replace(/\/route\.ts$/, "").replace(/\[[^\]]+\]/g, "x");
      deliberate.push(rel);
      expect(re.test(rel), `${rel} caches on purpose but the wide no-store rule would override it — add it to the carve-out in next.config.ts`).toBe(false);
    }
    // the list this was written against; a shrink here means a route lost its caching or moved
    expect(deliberate.length).toBeGreaterThanOrEqual(12);
  });
});

describe("nothing floats over the workspace's action bar", () => {
  it("the push nudge and the desktop Messages pill stay off /studio/ai/character-replace", () => {
    expect(code("features/notifications/push-nudge.tsx")).toContain('if ((pathname ?? "").startsWith("/studio/ai/character-replace")) return;');
    expect(code("features/app-shell/floating-messages.tsx")).toContain('if (pathname.startsWith("/studio/ai/character-replace")) return null;');
  });
});

describe("the words a first-time user reads", () => {
  it("steps are Replace → Photo → Video → Quality → Voice → Review (the scope on its own page since 2026-09-20)", () => {
    expect(WORKSPACE_STEPS.map((s) => s.label)).toEqual(["Replace", "Photo", "Video", "Quality", "Voice", "Review"]);
    expect(WORKSPACE_STEPS[0]?.title).toBe("What do you want to replace?");
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

describe("a gallery video is a voice source (owner, 2026-09-15)", () => {
  it("the picker accepts MP4 / MOV / WebM, the worker keeps the sound only, and the copy says so", () => {
    const v = src("lib/ai/voice/audio-validate.ts");
    expect(v).toContain('{ label: "MP4 video", extension: "mp4", mimeTypes: ["video/mp4"] },');
    expect(v).toContain('{ label: "MOV video", extension: "mov", mimeTypes: ["video/quicktime"] },');
    expect(v).toContain('return "webm";');
    expect(code("lib/ai/voice/audio-validate.ts")).not.toContain("if (probe.hasVideo) return");
    expect(src("lib/ai/voice/audio-ffmpeg.ts")).toContain('"-vn", "-map", "0:a:0"');
    expect(src("lib/ai/media.ts")).toContain('if (mime === "video/quicktime") return "mov";');
    const hook = src("features/ai/character-replace/use-character-replace-workspace.ts");
    expect(hook).toContain("const meta = await readVideoMetadata(objectUrl, { name: file.name, size: file.size, type: file.type });");
    // the browser's audio detection is not a gate (Safari fills audioTracks late); the worker decides
    expect(hook).toContain('duration = meta === "invalid" ? "invalid" : meta.durationMs;');
    expect(hook).not.toContain('meta.hasAudio === false ? "invalid"');
    expect(src("features/ai/character-replace/step-voice.tsx")).toContain('title="Upload audio or a video"');
  });
});
