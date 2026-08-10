import { WALLPAPER_DAILY_LIMITS, WALLPAPER_REWARD_SECONDS } from "@/lib/wallpapers-limits";
import type { Wallpaper } from "@/lib/wallpapers";

/**
 * /wallpapers as a SEARCH surface (owner, 2026-08-09: "make the wallpaper page a
 * seo page and add it to sitemap for indexing").
 *
 * ── What was actually wrong with it ───────────────────────────────────────────
 * The gallery itself was fine. As a page a search engine could read, it had five
 * concrete defects, all verified against the source before this file existed:
 *
 *   1. It was in NO sitemap. `app/sitemap.ts` listed 198 URLs and this was not
 *      one of them.
 *   2. Every image carried `alt=""` and `aria-hidden` — so an image gallery
 *      published exactly zero indexable images, which is the entire point of the
 *      page.
 *   3. Its body copy was fifteen words. A page competing for "free HD
 *      wallpapers" against Unsplash and Pexels with fifteen words of text has
 *      nothing to rank.
 *   4. It emitted no structured data at all.
 *   5. It had ONE outbound internal link (the back arrow). No footer, and no
 *      `MobileNav` either — that lives in the `(app)` layout and /wallpapers
 *      sits outside it, so a comment in the gallery claiming the page "already
 *      carries the app's bottom navigation" was wrong. A page with one link out
 *      passes no authority anywhere and gives a crawler nowhere to go.
 *
 * This file is the copy and the structured data, kept apart from the component
 * so both can be tested. The gallery keeps its reference design untouched; the
 * prose sits BELOW it, where a visitor who wants a picture has already got one.
 *
 * ── Nothing here is a claim we cannot back ────────────────────────────────────
 * No library size, no download count, no "trusted by" line, no invented star
 * rating. Those are the easiest sentences to write and the ones this project has
 * declined three times. Every number below is imported from the constant that
 * enforces it, so the copy cannot drift from the product: change the daily
 * allowance and this page changes with it.
 */

export const WALLPAPERS_PATH = "/wallpapers";

/** ~50 chars with the "· FrenzSave" template the root layout appends. */
export const WALLPAPERS_TITLE = "Free HD Wallpapers for Phone & Desktop";

/** 149 chars — inside the ~155 Google renders before truncating. */
export const WALLPAPERS_DESCRIPTION =
  "Browse a gallery of free HD wallpapers, preview any one full screen, and save it straight to your phone or desktop. No account and no watermark.";

/**
 * Kept short and honest about intent.
 *
 * `keywords` carries no weight with Google and has not since 2009, so this is
 * not an attempt to rank — it is for the smaller engines and AI crawlers that do
 * still read it, and it is the one place the page states plainly what it is for.
 * Stuffing it would cost more than it could ever return.
 */
export const WALLPAPERS_KEYWORDS = [
  "free wallpapers",
  "hd wallpapers",
  "phone wallpapers",
  "desktop wallpapers",
  "4k wallpapers",
  "wallpaper download",
  "background images",
];

export interface SeoSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

/**
 * The readable page — roughly 400 words.
 *
 * Written to be worth reading rather than to hit a word count: what the sizes
 * mean, how to actually apply a wallpaper on each platform, and what you may do
 * with the file afterwards. The third of those is the question a stock-image
 * page usually dodges, and dodging it is why so many of them are useless.
 */
export const WALLPAPERS_SECTIONS: SeoSection[] = [
  {
    id: "about",
    heading: "Wallpapers that fit the screen you actually own",
    paragraphs: [
      "Every wallpaper here is a full-resolution image, not a preview. Tap one to see it fill the screen the way it will look once it is set, then save it — the file that lands on your device is the same file the gallery is showing you, at the size it was uploaded.",
      "Where we have measured a wallpaper's pixels, its card carries the real badge: 4K for anything with a long edge of 3840 pixels or more, 2K from 2560, HD from 1920. A wallpaper whose dimensions we have not measured shows no badge at all rather than a flattering guess, so a chip on this page always means what it says.",
      "The Types filter works the same way. Phone, Desktop and Square are computed from each image's own aspect ratio, so filtering to Phone gives you portrait files that will not be cropped to pieces by a lock screen — and the filter only appears for shapes the library actually contains.",
    ],
  },
  {
    id: "how-to-set",
    heading: "How to set one as your wallpaper",
    paragraphs: [
      "On iPhone and iPad, tap the download button, then open Photos and find the image at the bottom of your library. Choose the share button, then Use as Wallpaper, and set it for the lock screen, the home screen or both. Safari may ask you to confirm the download first — that prompt is iOS, not us.",
      "On Android, downloading saves the file to your Pictures or Downloads folder. Open it in Gallery or Google Photos, tap the menu, and choose Use as or Set as wallpaper. Most launchers also let you long-press an empty part of the home screen and pick Wallpapers from there.",
      "On Windows, right-click the saved image and choose Set as desktop background. On macOS, right-click it and choose Set Desktop Picture, or add it under System Settings and then Wallpaper. Pick a Desktop-shaped wallpaper for a monitor and a Phone-shaped one for a handset — a portrait image stretched across a widescreen display is the single most common way a good wallpaper ends up looking bad.",
    ],
  },
  {
    id: "using-them",
    heading: "What you can do with them",
    paragraphs: [
      "These are published for personal use: your own phone, tablet, laptop and desktop. Set them, keep them, change them as often as you like.",
      "They are not offered under a stock-photo licence, so this page is not the place to source artwork for a product, a client, a print run or anything you intend to sell. We would rather say that plainly than imply a licence we have not granted. If you need one, or if you believe an image here is yours and should not be, our copyright and takedown process is real and answered by a person.",
    ],
  },
];

export interface SeoFaq {
  q: string;
  a: string;
}

/**
 * The questions people genuinely arrive with.
 *
 * The allowance and the ad length are interpolated from the constants that
 * enforce them (`lib/wallpapers-limits.ts`) rather than typed as literals — an
 * FAQ that says "five a day" after someone changes the cap to ten is worse than
 * having no FAQ, because it is confidently wrong at the exact moment a person is
 * trying to understand a limit they just hit.
 */
export const WALLPAPERS_FAQ: SeoFaq[] = [
  {
    q: "Are these wallpapers really free?",
    a: `Yes. Every wallpaper in the gallery can be downloaded at no cost. Free downloads are funded by a ${WALLPAPER_REWARD_SECONDS}-second ad that plays while the file transfers, and members on a paid plan skip the ad entirely.`,
  },
  {
    q: "Do I need an account to download a wallpaper?",
    a: "No. You can browse the whole library and download from it while signed out. An account is only needed to like, save or comment on a wallpaper, because those actions have to belong to someone.",
  },
  {
    q: "How many wallpapers can I download in a day?",
    a: `Free downloads are capped at ${WALLPAPER_DAILY_LIMITS.free} per day, and the count resets at midnight UTC. The cap exists because every free download shows a rewarded ad, and an unlimited stream of those to one person breaks the ad networks' own policies. Paid plans have no wallpaper cap and no ad.`,
  },
  {
    q: "What resolution are the wallpapers?",
    a: "It varies by image, which is why the badge on each card is measured rather than assumed. 4K means a long edge of at least 3840 pixels, 2K at least 2560, and HD at least 1920. Cards without a badge are ones whose dimensions we have not recorded — the picture is there to judge for yourself.",
  },
  {
    q: "Will a wallpaper fit my phone?",
    a: "Use the Types filter and choose Phone. Those are the portrait images, shaped for a handset lock screen. Desktop covers landscape files for monitors and laptops, and Square sits between the two for anything close to 1:1.",
  },
  {
    q: "Can I use these wallpapers commercially?",
    a: "No. They are published for personal use on your own devices, not under a stock-photo licence, so they should not be used in a product, a client project or anything for sale.",
  },
  {
    q: "Why did the download open an ad?",
    a: `A ${WALLPAPER_REWARD_SECONDS}-second rewarded ad is what pays for the free tier. It runs alongside the transfer rather than in front of it, so the file is already downloading while the ad plays, and closing the card does not cancel your download.`,
  },
];

/* ─────────────────────────── structured data ─────────────────────────────── */

export type JsonLdObject = Record<string, unknown>;

/**
 * How many wallpapers the ItemList names.
 *
 * The list is machine-readable context, not the index itself — Google Images
 * indexes the `<img>` elements in the document, which are all present. Every
 * entry costs roughly 200 bytes of HTML on a page that already ships a grid of
 * photographs, so the list establishes the page as a collection and then stops.
 */
export const WALLPAPERS_JSONLD_MAX = 60;

/**
 * One `ImageObject`, or null when we would have to invent something to emit it.
 *
 * The built-in placeholders are excluded outright. They are not our images —
 * they are third-party photos served from picsum.photos while the real library
 * is empty — and structured data is a machine-readable assertion of fact.
 * Declaring twelve stock photos as this site's wallpaper collection would teach
 * every crawler and knowledge base a false entity, and a wrong entity has to be
 * un-learned rather than edited.
 *
 * `width`/`height` appear only where they were measured, and `uploadDate` only
 * where there is a real upload timestamp. No `license`, no `acquireLicensePage`
 * and no `creator`: we do not hold licence terms per image, and a licence
 * declaration is exactly the field a crawler would be entitled to believe.
 */
function imageObject(w: Wallpaper, position: number): JsonLdObject | null {
  if (w.builtIn) return null;
  if (!/^https?:\/\//i.test(w.url)) return null;

  const measured = typeof w.width === "number" && typeof w.height === "number" && w.width > 0 && w.height > 0;
  const uploaded = w.createdAt && !Number.isNaN(Date.parse(w.createdAt)) ? w.createdAt : null;

  return {
    "@type": "ListItem",
    position,
    item: {
      "@type": "ImageObject",
      name: w.name,
      contentUrl: w.url,
      ...(w.thumbUrl && /^https?:\/\//i.test(w.thumbUrl) ? { thumbnailUrl: w.thumbUrl } : {}),
      ...(measured ? { width: w.width, height: w.height } : {}),
      ...(uploaded ? { uploadDate: uploaded } : {}),
      ...(w.category ? { keywords: w.category } : {}),
    },
  };
}

/**
 * Every block of structured data this page emits.
 *
 * `FAQPage` is included knowing Google stopped rendering FAQ rich results for
 * general sites in August 2023. It is not there for stars in the SERP — it is
 * there because the answers are true and machine-readable, and the crawlers that
 * now answer questions directly do read it. That is a different and, for this
 * product, more useful audience.
 *
 * Serialisation is the caller's job and must go through `jsonLd()` — wallpaper
 * titles are operator-authored, so a raw `JSON.stringify` here would be a stored
 * XSS vector the moment a title contained a closing script tag.
 */
export function wallpapersJsonLd(items: Wallpaper[], siteUrl: string): JsonLdObject[] {
  const url = `${siteUrl}${WALLPAPERS_PATH}`;

  const listItems = items
    .slice(0, WALLPAPERS_JSONLD_MAX)
    .map((w, i) => imageObject(w, i + 1))
    .filter((entry): entry is JsonLdObject => entry !== null)
    // Re-number after the veracity filter, so positions stay 1..n with no gaps
    // where a built-in was dropped.
    .map((entry, i) => ({ ...entry, position: i + 1 }));

  const breadcrumb: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Wallpapers", item: url },
    ],
  };

  const collection: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: WALLPAPERS_TITLE,
    description: WALLPAPERS_DESCRIPTION,
    url,
    isPartOf: { "@type": "WebSite", name: "FrenzSave", url: siteUrl },
    // An empty library emits no list rather than an ItemList of nothing, which
    // reads to a crawler as a collection page with a collection of zero.
    ...(listItems.length > 0
      ? {
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: listItems.length,
            itemListElement: listItems,
          },
        }
      : {}),
  };

  const faq: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: WALLPAPERS_FAQ.map((entry) => ({
      "@type": "Question",
      name: entry.q,
      acceptedAnswer: { "@type": "Answer", text: entry.a },
    })),
  };

  return [breadcrumb, collection, faq];
}

/**
 * The categories the library actually contains, largest first.
 *
 * Rendered as text on the server so a crawler reads the real subject matter of
 * the page — "Nature", "Abstract", "Minimal" — instead of a grid of images with
 * no words near them. Derived from the same array the gallery renders, so it can
 * never name a category with nothing in it.
 */
export function wallpaperCategoryCounts(items: Wallpaper[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of items) {
    const name = w.category?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
