import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Film } from "lucide-react";
import { describe, expect, it } from "vitest";

import { FAQS } from "@/components/landing/faq-data";
import { DEFERRED_PARTS, renderDeferredSections } from "@/lib/landing/deferred-sections";
import { brandSvg, lucideSvg } from "@/lib/landing/svg-string";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { getPrimaryPages } from "@/lib/seo/seo-pages";

/**
 * Owner, 2026-10-19: "Make sure the landing is very light … below section shouldn't load on landing."
 * The sections below the hero are not in the landing document; they are static markup fetched when
 * scrolled near. These pin that, and that nothing was lost on the way.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const page = src("app/(marketing)/page.tsx");
const parts = renderDeferredSections();

/** Every part the module renders has a placeholder on the page, and no section renders inline. */
function pageDefersEverything(pageSrc: string) {
  const missing = DEFERRED_PARTS.filter((p) => !pageSrc.includes(`<DeferredSection part="${p}"`));
  const inline = /<(FeaturesGrid|HowItWorks|Faq|FrenzAiSection|DiscoverSection|CtaBanner|DownloaderLinks)\b/.exec(pageSrc)?.[1] ?? null;
  return { missing, inline };
}

describe("the landing's deferred sections", () => {
  it("every part has a placeholder on the page and none is rendered inline", () => {
    expect(pageDefersEverything(page)).toEqual({ missing: [], inline: null });
  });

  it("teeth: a dropped placeholder or a section put back inline is caught", () => {
    expect(pageDefersEverything(page.replace('<DeferredSection part="faq"', "<div")).missing).toEqual(["faq"]);
    expect(pageDefersEverything(page + "\n<FeaturesGrid />").inline).toBe("FeaturesGrid");
  });

  it("each part is real markup with its heading, and carries no script and no gradient text", () => {
    for (const p of DEFERRED_PARTS) {
      const html = parts[p];
      expect(html, p).toMatch(/^<section aria-labelledby="landing-[a-z]+" class="frenz-ui /);
      expect(html, p).toMatch(/<h2 id="landing-[a-z]+"/);
      expect(html, p).not.toMatch(/<script|bg-clip-text|text-gradient|on[a-z]+="/);
    }
  });

  it("nothing was lost: every FAQ question and every platform page link is there", () => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    for (const f of FAQS) expect(parts.faq).toContain(esc(f.q));
    for (const d of getPrimaryPages()) expect(parts.platforms).toContain(`href="/${d.slug}"`);
    // the AI tools and both AI doors keep their analytics tags
    expect(parts.ai).toContain('data-track="ai_reels_clicked"');
    expect(parts.ai.match(/data-track="ai_clicked"/g)!.length).toBeGreaterThan(2);
  });

  it("the FAQ's structured data stays in the document itself", () => {
    expect(page).toContain("<FaqJsonLd />");
  });

  it("the route is static: built once, no request, cookie or database read", () => {
    const route = src("app/landing-sections/route.ts");
    expect(route).toContain('export const dynamic = "force-static";');
    expect(route).not.toMatch(/cookies\(|headers\(|request\.|supabase/i);
  });
});

describe("icons as SVG strings", () => {
  it("draws lucide and brand icons from their own data, decorative", () => {
    const film = lucideSvg(Film, "h-5 w-5");
    expect(film).toMatch(/^<svg [^>]*aria-hidden="true">/);
    expect(film).toContain('<path d="M7 3v18"/>');
    const tiktok = brandSvg(BRAND_ICONS.tiktok!, "h-4 w-4");
    expect(tiktok).toMatch(/<path d="M12\.525/);
    expect(tiktok).not.toContain('role="img"');
  });

  it("skips the empty child slots a production build leaves (the /landing-sections prerender crashed on one)", () => {
    const Fake = (() => ({ type: function minified() {}, props: { attr: { viewBox: "0 0 8 8" }, children: [undefined, false, { type: "path", props: { d: "M0 0" } }] } })) as unknown as Parameters<typeof brandSvg>[0];
    expect(brandSvg(Fake, "x")).toContain('<path d="M0 0"></path>');
  });
});
