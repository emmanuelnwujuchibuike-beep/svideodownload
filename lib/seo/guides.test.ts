import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KLING_OMNI_MODEL } from "@/lib/ai/kling/config";
import { GENOMES } from "@/lib/content/genome/registry";

import { GUIDES, guideSlug, type Guide } from "./guides";

/**
 * The SEO guides (2026-10-09) — every claim on them tied to the real product.
 * Each check names the failure it prevents, and each family has a teeth case.
 */

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const textOf = (g: Guide) => [g.title, g.description, g.h1, g.intro, ...g.blocks.flatMap((b) => [b.h2, ...(b.paragraphs ?? []), ...(b.steps ?? []), ...(b.bullets ?? [])]), ...g.faqs.flatMap((f) => [f.q, f.a]), g.cta.label].join("\n");
const sentences = (g: Guide) => textOf(g).split(/(?<=[.!?])\s+|\n/);
/** Statements only: a heading or a question claims nothing (its answer is checked as a statement). */
const claims = (g: Guide) => sentences(g).filter((x) => !x.trim().endsWith("?") && !g.blocks.some((b) => b.h2 === x.trim()));

/** Where a link lands: a guide, or a real page file in the app. */
function routeExists(href: string): boolean {
  const path = href.split("#")[0]!;
  if (GUIDES.some((g) => g.path === path)) return true;
  if (path === "/") return true;
  const candidates = [`app/(marketing)${path}/page.tsx`, `app/(app)${path}/page.tsx`, `app${path}/page.tsx`];
  return candidates.some((c) => existsSync(join(ROOT, c)));
}

describe("SEO guides: one source, unique, complete", () => {
  it("paths, titles and descriptions are unique; every field is filled", () => {
    for (const key of ["path", "title", "description", "h1"] as const) {
      const vals = GUIDES.map((g) => g[key]);
      expect(new Set(vals).size, key).toBe(vals.length);
    }
    for (const g of GUIDES) {
      expect(g.intro.length, g.path).toBeGreaterThan(120);
      expect(g.blocks.length, g.path).toBeGreaterThanOrEqual(2);
      expect(g.updated, g.path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("titles and descriptions fit a search result", () => {
    for (const g of GUIDES) {
      expect(g.title.length, g.title).toBeLessThanOrEqual(75);
      expect(g.description.length, g.path).toBeGreaterThanOrEqual(80);
      expect(g.description.length, g.path).toBeLessThanOrEqual(170);
    }
  });

  it("every path sits under its own section; only the hub has no slug", () => {
    for (const g of GUIDES) {
      expect(g.path.startsWith(`/${g.section}`), g.path).toBe(true);
      if (g.path !== "/frenz-ai") expect(guideSlug(g), g.path).toMatch(/^[a-z0-9-]+$/);
    }
    // teeth: /advertise itself is the existing page, never a second guide
    expect(GUIDES.some((g) => g.path === "/advertise")).toBe(false);
  });

  it("every CTA and related link lands on a page that exists", () => {
    for (const g of GUIDES) {
      expect(routeExists(g.cta.href), `${g.path} → ${g.cta.href}`).toBe(true);
      for (const r of g.related) expect(routeExists(r), `${g.path} → ${r}`).toBe(true);
    }
    // teeth
    expect(routeExists("/frenz-ai/does-not-exist")).toBe(false);
  });
});

describe("SEO guides: only what Frenz AI really does", () => {
  const live = new Map(GENOMES.ai!.capabilities.filter((c) => c.stage === "live").map((c) => [c.id, c]));

  it("a tool page exists only for a LIVE capability, and opens that capability's own route", () => {
    for (const g of GUIDES.filter((x) => x.capability.kind === "genome")) {
      const id = (g.capability as { id: string }).id;
      const cap = live.get(id);
      expect(cap, `${g.path}: ${id} is not live`).toBeTruthy();
      expect(g.cta.href, g.path).toBe(cap!.provingRoute);
    }
  });

  it("the Kling model named on the pages is the one the integration calls", () => {
    // if the integration moves off Kling 3.0 Omni, the copy must move with it
    expect(KLING_OMNI_MODEL).toBe("kling-v3-omni");
    const named = GUIDES.filter((g) => /Kling 3\.0 Omni/.test(textOf(g)));
    expect(named.length).toBeGreaterThan(2);
  });

  it("character replacement and face swap are never offered — the tool is retired", () => {
    expect(src("lib/ai/character-replace/submit.ts")).toMatch(/Character Replace is retired/);
    for (const g of GUIDES) {
      expect(g.cta.href, g.path).not.toMatch(/character-replace/);
      for (const s of claims(g).filter((x) => /character replace|character replacement|face swap/i.test(x))) {
        expect(s, `${g.path}: "${s}"`).toMatch(/\b(not|no|retired|doesn't|does not)\b/i);
      }
    }
  });

  it("Kling 4.0 is only ever an announcement — never something Frenz AI runs", () => {
    for (const g of GUIDES) {
      for (const s of claims(g).filter((x) => /Kling 4/.test(x))) {
        expect(s, `${g.path}: "${s}"`).toMatch(/\b(announced|not|No)\b/);
      }
    }
    // teeth: the pattern does catch a claim
    expect("Create videos with Kling 4.0 in Frenz AI.").not.toMatch(/\b(announced|not|No)\b/);
  });

  it("no affiliation is claimed with Kling", () => {
    const kling = GUIDES.find((g) => g.capability.kind === "kling")!;
    expect(textOf(kling)).toMatch(/not affiliated with/);
    // any sentence about a relationship with Kling must deny it
    for (const g of GUIDES) {
      for (const s of claims(g).filter((x) => /Kling|Kuaishou/.test(x) && /partner|endorsed|affiliated|official/i.test(x))) {
        expect(s, `${g.path}: "${s}"`).toMatch(/\b(not|No)\b/);
      }
    }
    // teeth
    expect("Frenzsave is an official Kling partner.").not.toMatch(/\b(not|No)\b/);
  });

  it("no invented numbers, guarantees or rankings", () => {
    const banned = /\bguarantee|\bmillions?\b|#1|number one|\bbest\b.*\bin the world|testimonial|\bunlimited\b|instant(ly)? (indexing|ranking)/i;
    for (const g of GUIDES) expect(textOf(g), g.path).not.toMatch(banned);
    // advertising pages never hard-code a price: the live islands show them
    for (const g of GUIDES.filter((x) => x.section === "advertise")) expect(textOf(g), g.path).not.toMatch(/[$₦]\s?\d|\bNGN\s?\d|\bUSD\s?\d/);
    // teeth
    expect("Reach millions of users").toMatch(banned);
  });
});

describe("SEO guides: static, light and private", () => {
  it("the template and routes load no generation code and read no session", () => {
    const files = ["features/seo/guide-page.tsx", "app/(marketing)/frenz-ai/page.tsx", "app/(marketing)/frenz-ai/[slug]/page.tsx", "app/(marketing)/advertise/[guide]/page.tsx"];
    for (const f of files) {
      const s = src(f);
      expect(s, f).not.toMatch(/from "@\/(lib|features)\/ai\//);
      expect(s, f).not.toMatch(/cookies\(\)|headers\(\)|createClient|getUser/);
      if (f.includes("app/")) expect(s, f).toContain(`export const dynamic = "force-static"`);
    }
    expect(src("app/(marketing)/frenz-ai/[slug]/page.tsx")).toContain("export const dynamicParams = false");
    expect(src("app/(marketing)/advertise/[guide]/page.tsx")).toContain("export const dynamicParams = false");
  });

  it("links into a tool never prefetch its bundle", () => {
    const t = src("features/seo/guide-page.tsx");
    expect(t).toContain(`prefetch={isTool(href) ? false : undefined}`);
    expect(t).toMatch(/const isTool = \(href: string\) => href\.startsWith\("\/ai"\)/);
  });

  it("the sitemap lists every guide with its real date; robots keeps the tools out and lets the guides in", () => {
    const sm = src("app/sitemap.ts");
    expect(sm).toContain("...GUIDES.map((g) => ({");
    expect(sm).toContain("lastModified: g.updated");
    expect(sm).toContain("`${siteUrl}/advertise`");
    const robots = src("app/robots.ts");
    expect(robots).toMatch(/const disallow = \[[^\]]*"\/ai"/);
    expect(robots).not.toMatch(/"\/frenz-ai/);
    // a "/ai" prefix rule never matches the guides
    expect("/frenz-ai/kling-ai".startsWith("/ai")).toBe(false);
  });

  it("private advertising pages stay out of the index", () => {
    for (const p of ["campaigns", "payment", "create"]) expect(src(`app/(marketing)/advertise/${p}/page.tsx`), p).toMatch(/robots:\s*\{\s*index:\s*false/);
    for (const g of GUIDES) expect(["/advertise/campaigns", "/advertise/payment", "/advertise/create"]).not.toContain(g.path);
  });
});
