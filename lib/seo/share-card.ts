import { SITE_NAME } from "@/lib/seo/page-metadata";
import { SHARE_DESCRIPTION, SHARE_TITLE } from "@/lib/seo/share";

/**
 * The share card a link-preview fetcher gets for an app-only route (code review, 2026-10-30 — see
 * lib/seo/link-preview-bots.ts): the <head> tags a chat app reads to draw its preview, and a sign-in link. Nothing of
 * the page itself — no feed, post, reel or comment — so it carries no more than the pages' own metadata always did.
 *
 * Like TikTok, Instagram and Facebook (owner, 2026-10-30: "the content shows only the image and not the profile
 * preview unless it was the Profile link"): a PROFILE link is the person's card — their photo, name and bio, as the
 * small card; a CONTENT link (a reel, a sound) is that content's own picture, as the large card, with its own caption —
 * never the creator's profile photo.
 *
 * Pure: the route (app/api/share-card) looks the profile, reel or sound up and hands the result here.
 */
export interface ShareCard {
  title: string;
  description: string;
  /** The address the card points at (og:url) — relative to the site, or absolute. */
  url: string;
  /** The profile photo (a profile card) or the content's own picture; null → the site's own share image. */
  image: string | null;
  /** "profile" is the only card that shows a person; every other type is content (or the site) and shows large. */
  type: "website" | "profile" | "music.song" | "video.other";
  /** Where a person who somehow lands on the card goes: sign in, then the address that was shared. */
  signInPath: string;
}

/** The site-wide share image (app/opengraph-image.tsx). */
export const SITE_SHARE_IMAGE = "/opengraph-image";

/** A few app-only areas a member shares by address; anything else carries the site's own title. */
const AREA_TITLES: readonly (readonly [prefix: string, title: string])[] = [
  ["/reels", `Reels on ${SITE_NAME}`],
  ["/exclusive", `Frenz Exclusive on ${SITE_NAME}`],
  ["/sounds", `Sounds on ${SITE_NAME}`],
];

/** The card for a shared app-only address with no profile or sound behind it (or one that could not be read). */
export function genericShareCard(path: string, sharedAddress: string): ShareCard {
  const area = AREA_TITLES.find(([p]) => path === p || path.startsWith(`${p}/`));
  return {
    title: area?.[1] ?? SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    url: sharedAddress,
    image: null,
    type: "website",
    signInPath: signInPathFor(sharedAddress),
  };
}

export function signInPathFor(sharedAddress: string): string {
  return `/login?next=${encodeURIComponent(sharedAddress)}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function absolute(u: string, siteUrl: string): string {
  try {
    return new URL(u, `${siteUrl}/`).toString();
  } catch {
    return `${siteUrl}/`;
  }
}

/** The whole card document. Every value is escaped; every address is made absolute on the site. */
export function renderShareCard(card: ShareCard, siteUrl: string): string {
  const url = absolute(card.url, siteUrl);
  const image = absolute(card.image ?? SITE_SHARE_IMAGE, siteUrl);
  // a profile photo is the small card beside the name; content (and the site's own image) is the large picture
  const twitterCard = card.type === "profile" ? "summary" : "summary_large_image";
  const title = card.title.slice(0, 200);
  const description = card.description.slice(0, 300);
  const meta = [
    `<meta name="robots" content="noindex, nofollow">`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:type" content="${card.type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta name="twitter:card" content="${twitterCard}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
  ].join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${meta}
</head>
<body>
<p><a href="${esc(absolute(card.signInPath, siteUrl))}">Sign in to open this on ${esc(SITE_NAME)}</a></p>
</body>
</html>
`;
}
