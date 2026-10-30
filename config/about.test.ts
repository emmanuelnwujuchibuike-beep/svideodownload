import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { aboutOwnerLines, isFilledIn, SITE_OWNER, type SiteOwner } from "@/config/about";

/**
 * The /about page never prints a placeholder (code review, 2026-10-30): it shipped "Frenzsave is run by [Company/owner
 * name], based in [Country/city] …" to every visitor and reviewer. Truth rule — a real value or nothing. The page is
 * rendered to markup exactly as served (the site header/footer stubbed out — they are not what is under test).
 */
vi.mock("@/components/layout/page-shell", () => ({
  PageShell: ({ title, children }: { title: string; children: ReactNode }) => createElement("main", null, createElement("h1", null, title), children),
}));

const FILLED: SiteOwner = { company: "Acme Media Ltd", location: "Lagos, Nigeria", founded: "2025", founder: "Ada Obi", founderBio: "Builds tools for creators." };
/** Any "[Something …]" left in what a reader sees. */
const PLACEHOLDER = /\[[A-Z][^\]]*\]/;

describe("About — who runs Frenzsave", () => {
  it("the served page carries no bracketed placeholder (teeth: the old page fails this)", async () => {
    const { default: AboutPage } = await import("@/app/(marketing)/about/page");
    const html = renderToStaticMarkup(createElement(AboutPage));
    expect(html).toContain("About Frenzsave");
    expect(html).not.toMatch(PLACEHOLDER);
    // the detector itself bites: the sentence the old page rendered is caught
    expect("Frenzsave is run by [Company/owner name], based in [Country/city]").toMatch(PLACEHOLDER);
  });

  it("while every value is a placeholder, 'Who we are' is left out and the description stops promising it", async () => {
    const page = await import("@/app/(marketing)/about/page");
    const html = renderToStaticMarkup(createElement(page.default));
    const lines = aboutOwnerLines();
    if (!lines.runBy && !lines.founder) {
      expect(html).not.toContain("Who we are");
      expect(String(page.metadata.description)).toMatch(/^Why Frenzsave exists:/);
    } else {
      expect(html).toContain("Who we are");
      expect(String(page.metadata.description)).toMatch(/^Who runs Frenzsave and why:/);
    }
  });

  it("filled in: the exact sentence the owner wrote the page around", () => {
    expect(aboutOwnerLines(FILLED)).toEqual({
      runBy: "Frenzsave is run by Acme Media Ltd, based in Lagos, Nigeria, and has been building since 2025.",
      founder: { name: "Ada Obi", bio: "Builds tools for creators." },
    });
  });

  it("partly filled: only the parts that are real, never a dangling placeholder", () => {
    const placeholders = SITE_OWNER;
    expect(aboutOwnerLines({ ...placeholders, company: "Acme Media Ltd" }).runBy).toBe("Frenzsave is run by Acme Media Ltd.");
    expect(aboutOwnerLines({ ...placeholders, founded: "2025" }).runBy).toBe("Frenzsave has been building since 2025.");
    expect(aboutOwnerLines({ ...placeholders, location: "Lagos" }).runBy).toBe("Frenzsave is based in Lagos.");
    expect(aboutOwnerLines({ ...placeholders, founder: "Ada Obi" }).founder).toEqual({ name: "Ada Obi", bio: null });
  });

  it("teeth: a bracketed or empty value is never 'filled in'", () => {
    for (const v of ["[Year founded]", "  [Founder name]  ", "", "   "]) expect(isFilledIn(v), JSON.stringify(v)).toBe(false);
    for (const v of ["2025", "Ada Obi", "Lagos [HQ]"]) expect(isFilledIn(v), v).toBe(true);
    expect(aboutOwnerLines({ company: "[Company/owner name]", location: "[Country/city]", founded: "[Year founded]", founder: "[Founder name]", founderBio: "[Short founder bio]" })).toEqual({
      runBy: null,
      founder: null,
    });
  });
});
