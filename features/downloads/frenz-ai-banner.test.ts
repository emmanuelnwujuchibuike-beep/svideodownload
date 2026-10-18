import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Frenz AI is the featured, full-width door on the landing and /downloads (owner, 2026-10-18). */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const featured = (core: string, cta: string) => {
  const ai = core.indexOf("<FrenzAICta promo={aiPromo} />");
  const row = core.indexOf('<WallpaperCta variant="row"');
  return (
    ai > 0 &&
    row > ai &&
    core.indexOf("<DownloadBox") < ai &&
    cta.includes('data-track="ai_clicked"') &&
    cta.includes("bg-gradient-to-br from-blue-400 via-violet-500 to-fuchsia-500 p-[1.5px]") &&
    cta.includes("Try now") &&
    cta.includes("Create amazing videos with AI") &&
    !cta.includes('"use client"') &&
    !/animation:[^"]*infinite|animate-/.test(cta)
  );
};

describe("the Frenz AI banner", () => {
  const core = read("features/downloads/download-page-core.tsx");
  const cta = read("features/downloads/frenz-ai-cta.tsx");

  it("sits full width under the paste card, above the wallpaper row, static and server-rendered", () => {
    expect(featured(core, cta)).toBe(true);
  });

  it("keeps the promotion overlay and the one-tap prefetch", () => {
    expect(cta).toContain("{playsMedia ? <AiPromoLoader promo={promo!} /> : null}");
    expect(cta).not.toContain("prefetch={false}");
  });

  it("teeth: a banner that animates, hides its button, or sits below the wallpapers fails", () => {
    expect(featured(core, cta + '\nconst a = "animate-pulse";')).toBe(false);
    expect(featured(core, cta.replace("Try now", ""))).toBe(false);
    expect(featured(core.replace("<FrenzAICta promo={aiPromo} />", ""), cta)).toBe(false);
    expect(featured(core.replace('<WallpaperCta variant="row"', '<WallpaperCta variant="card"'), cta)).toBe(false);
  });
});
