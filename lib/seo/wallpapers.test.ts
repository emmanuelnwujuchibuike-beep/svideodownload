import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { SITE_URL } from "@/lib/site";
import { wallpaperAlt, type Wallpaper } from "@/lib/wallpapers";
import { WALLPAPER_DAILY_LIMITS, WALLPAPER_REWARD_SECONDS } from "@/lib/wallpapers-limits";

import {
  WALLPAPERS_DESCRIPTION,
  WALLPAPERS_FAQ,
  WALLPAPERS_JSONLD_MAX,
  WALLPAPERS_PATH,
  WALLPAPERS_SECTIONS,
  WALLPAPERS_TITLE,
  wallpaperCategoryCounts,
  wallpapersJsonLd,
  type JsonLdObject,
} from "./wallpapers";

/**
 * The wallpaper page's search surface.
 *
 * Two things are being defended here, and only one of them is SEO.
 *
 * The first is that the page is REACHABLE and DESCRIBED — in the sitemap, with a
 * title and description that survive a SERP, and with structured data a crawler
 * can parse.
 *
 * The second matters more: that none of it asserts anything untrue. Structured
 * data is machine-readable fact, and a wrong entity propagates into third-party
 * knowledge bases and outlives the fix. So the tests below spend most of their
 * effort on what the JSON-LD must REFUSE to say — unmeasured dimensions,
 * placeholder images that are not ours, and licence terms we do not hold.
 */

function base(overrides: Partial<Wallpaper> = {}): Wallpaper {
  return {
    id: "w1",
    name: "Aurora Ridge",
    category: "Nature",
    url: "https://cdn.example.com/aurora.jpg",
    thumbUrl: "https://cdn.example.com/aurora-thumb.jpg",
    downloadUrl: "/api/wallpaper?id=w1&dl=1",
    likes: 0,
    saves: 0,
    comments: 0,
    views: 0,
    downloads: 0,
    width: 2160,
    height: 3840,
    createdAt: "2026-08-01T10:00:00.000Z",
    builtIn: false,
    ...overrides,
  };
}

/** Pull the CollectionPage / FAQPage / BreadcrumbList block out of the array. */
function block(blocks: JsonLdObject[], type: string): JsonLdObject {
  const found = blocks.find((b) => b["@type"] === type);
  expect(found, `expected a ${type} block`).toBeTruthy();
  return found!;
}

function listEntries(blocks: JsonLdObject[]): JsonLdObject[] {
  const collection = block(blocks, "CollectionPage");
  const list = collection.mainEntity as { itemListElement?: JsonLdObject[] } | undefined;
  return list?.itemListElement ?? [];
}

describe("wallpapers page metadata", () => {
  it("has a title and description that survive a search result", () => {
    // Google renders roughly 60 chars of title and 155 of description before it
    // truncates. The root layout appends " · FrenzSave", so the title is
    // measured with the template it will actually ship with.
    expect(`${WALLPAPERS_TITLE} · FrenzSave`.length).toBeLessThanOrEqual(60);
    expect(WALLPAPERS_DESCRIPTION.length).toBeLessThanOrEqual(155);
    expect(WALLPAPERS_DESCRIPTION.length).toBeGreaterThan(70);
  });

  it("is listed in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`${SITE_URL}${WALLPAPERS_PATH}`);
  });

  it("carries enough prose to be a page rather than a grid", () => {
    const words = WALLPAPERS_SECTIONS.flatMap((s) => s.paragraphs)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean);
    // The page shipped with fifteen words of body copy. This is the floor that
    // stops it quietly returning there.
    expect(words.length).toBeGreaterThan(300);
  });

  it("states no engagement or inventory figure it cannot back", () => {
    const prose = [
      ...WALLPAPERS_SECTIONS.flatMap((s) => [s.heading, ...s.paragraphs]),
      ...WALLPAPERS_FAQ.flatMap((f) => [f.q, f.a]),
      WALLPAPERS_DESCRIPTION,
      WALLPAPERS_TITLE,
    ].join(" ");

    // "10,000+ wallpapers", "millions of downloads", "trusted by 5,000 users" —
    // the sentences that write themselves and that this project has declined
    // three times. Real display standards (3840, 2560, 1920) are numbers about
    // the FILES, not about us, so a blanket digit ban would be the wrong test.
    expect(prose).not.toMatch(/\d[\d,]*\s*\+/);
    expect(prose).not.toMatch(/\b(millions?|billions?|thousands)\b/i);
    expect(prose).not.toMatch(/trusted by|loved by|join \d/i);
  });
});

describe("wallpapers FAQ", () => {
  it("quotes the allowance from the constant that enforces it", () => {
    const answers = WALLPAPERS_FAQ.map((f) => f.a).join(" ");
    // If someone changes the cap, this page changes with it — the failure mode
    // being prevented is an FAQ confidently explaining a limit that no longer
    // exists, read by a person at the moment they hit the real one.
    expect(answers).toContain(String(WALLPAPER_DAILY_LIMITS.free));
    expect(answers).toContain(String(WALLPAPER_REWARD_SECONDS));
  });

  it("answers every question it asks", () => {
    for (const entry of WALLPAPERS_FAQ) {
      expect(entry.q.endsWith("?")).toBe(true);
      expect(entry.a.length).toBeGreaterThan(40);
    }
  });
});

describe("wallpapers structured data", () => {
  it("emits breadcrumb, collection and FAQ blocks", () => {
    const blocks = wallpapersJsonLd([base()], SITE_URL);
    for (const type of ["BreadcrumbList", "CollectionPage", "FAQPage"]) {
      expect(blocks.some((b) => b["@type"] === type)).toBe(true);
    }
    for (const b of blocks) expect(b["@context"]).toBe("https://schema.org");
  });

  it("never declares a built-in placeholder as ours", () => {
    // The placeholders are third-party photos shown while the real library is
    // empty. Declaring them would teach every crawler a false collection.
    const blocks = wallpapersJsonLd(
      [base({ id: "b1", builtIn: true, url: "https://picsum.photos/seed/frenz-wp-1/1080/1920" }), base()],
      SITE_URL,
    );
    const entries = listEntries(blocks);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain("picsum");
  });

  it("omits the ItemList entirely when nothing real is publishable", () => {
    const blocks = wallpapersJsonLd([base({ builtIn: true })], SITE_URL);
    expect(block(blocks, "CollectionPage").mainEntity).toBeUndefined();
  });

  it("omits dimensions that were never measured", () => {
    const blocks = wallpapersJsonLd([base({ width: null, height: null })], SITE_URL);
    const [entry] = listEntries(blocks);
    const item = entry!.item as Record<string, unknown>;
    expect(item.width).toBeUndefined();
    expect(item.height).toBeUndefined();
    // The image is still published — it just does not claim a size.
    expect(item.contentUrl).toBe("https://cdn.example.com/aurora.jpg");
  });

  it("omits an upload date it cannot parse", () => {
    const blocks = wallpapersJsonLd([base({ createdAt: "not a date" })], SITE_URL);
    const item = (listEntries(blocks)[0]!.item) as Record<string, unknown>;
    expect(item.uploadDate).toBeUndefined();
  });

  it("asserts no licence, price or author", () => {
    const blocks = wallpapersJsonLd([base()], SITE_URL);
    const serialised = JSON.stringify(blocks);
    // We hold no per-image licence terms. A licence field is precisely the one a
    // crawler would be entitled to believe, so it must not be guessed at.
    for (const field of ["license", "acquireLicensePage", "creator", "copyrightHolder", "offers"]) {
      expect(serialised).not.toContain(`"${field}"`);
    }
  });

  it("numbers list positions contiguously after filtering", () => {
    const items = [base({ id: "a" }), base({ id: "b", builtIn: true }), base({ id: "c" })];
    const positions = listEntries(wallpapersJsonLd(items, SITE_URL)).map((e) => e.position);
    expect(positions).toEqual([1, 2]);
  });

  it("caps the list so the document does not balloon", () => {
    const many = Array.from({ length: WALLPAPERS_JSONLD_MAX + 25 }, (_, i) => base({ id: `w${i}` }));
    expect(listEntries(wallpapersJsonLd(many, SITE_URL))).toHaveLength(WALLPAPERS_JSONLD_MAX);
  });

  it("points the breadcrumb and canonical at the real URL", () => {
    const blocks = wallpapersJsonLd([base()], SITE_URL);
    expect(block(blocks, "CollectionPage").url).toBe(`${SITE_URL}/wallpapers`);
    const crumbs = block(blocks, "BreadcrumbList").itemListElement as { item: string }[];
    expect(crumbs.map((c) => c.item)).toEqual([SITE_URL, `${SITE_URL}/wallpapers`]);
  });
});

describe("alt text and category counts", () => {
  it("names the picture without stuffing keywords into it", () => {
    expect(wallpaperAlt({ name: "Aurora Ridge", category: "Nature" })).toBe("Aurora Ridge — nature wallpaper");
    // Read aloud to somebody, and a spam signal when it reads like a search
    // query. Length is the cheap proxy that catches a future "stunning 4K HD
    // free download background" rewrite.
    expect(wallpaperAlt({ name: "Aurora Ridge", category: "Nature" }).length).toBeLessThan(125);
  });

  it("survives a wallpaper with no category", () => {
    expect(wallpaperAlt({ name: "Aurora", category: "" })).toBe("Aurora wallpaper");
  });

  it("counts real categories, largest first, and invents none", () => {
    const counts = wallpaperCategoryCounts([
      base({ category: "Nature" }),
      base({ category: "Abstract" }),
      base({ category: "Nature" }),
      base({ category: "  " }),
    ]);
    expect(counts).toEqual([
      { name: "Nature", count: 2 },
      { name: "Abstract", count: 1 },
    ]);
  });
});
