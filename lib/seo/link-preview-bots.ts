/**
 * The fetchers that build a LINK PREVIEW when someone pastes a Frenzsave link into a chat or a post (code review,
 * 2026-10-30): WhatsApp, X, Facebook/Messenger, iMessage, Telegram, Slack, Discord, LinkedIn and friends.
 *
 * The app-only routes (lib/auth/app-only-paths.ts) send every cookie-less request to /login, and these fetchers never
 * carry a cookie — so a member sharing frenzsave.com/chris, a sound or a reel got the LOGIN page's card instead of the
 * profile's. The middleware now answers these fetchers with a share card instead (app/api/share-card): the title,
 * description and picture — the same fields the pages' own metadata already published — and never the page itself.
 *
 * 🔴 Search and ad crawlers are NOT on this list and never may be: Googlebot, Mediapartners-Google (AdSense) and Bing
 * still get the sign-in redirect, so what the AdSense review reads is unchanged (owner, 2026-10-29). Each token is the
 * fetcher's own product name — never an in-app browser's (Twitter's app says "Twitter", Slack's "Slack", LinkedIn's
 * "LinkedInApp", Facebook's "FBAN"), so a person tapping a link inside those apps still gets the normal page.
 *
 * The same names head the robots.txt group that lets these fetchers read the shared routes (app/robots.ts) — X and
 * LinkedIn draw no card for a URL robots.txt disallows.
 */
export const LINK_PREVIEW_AGENTS = [
  "facebookexternalhit", // Facebook, Messenger, Instagram DMs — and iMessage, which sends this token too
  "Facebot",
  "Twitterbot",
  "WhatsApp", // also what Signal sends
  "TelegramBot",
  "Slackbot",
  "Discordbot",
  "LinkedInBot",
  "Pinterestbot",
  "redditbot",
  "SkypeUriPreview", // Skype and Microsoft Teams
  "Iframely",
  "Embedly",
  "vkShare",
  "Cardyb", // Bluesky
  "kakaotalk-scrap",
] as const;

/** Never a preview fetcher, whatever else the string carries. */
const SEARCH_OR_AD_CRAWLER = /googlebot|mediapartners-google|adsbot-google|google-inspectiontool|bingbot|adidxbot|bingpreview/i;

/** WhatsApp's own previews read "WhatsApp/2.x"; the bare word alone is not enough. */
const PREVIEW_UA = new RegExp(LINK_PREVIEW_AGENTS.map((t) => (t === "WhatsApp" ? "WhatsApp/" : t)).join("|"), "i");

/** True only for a link-preview fetcher (never a search or ad crawler, never a person's browser). */
export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua || SEARCH_OR_AD_CRAWLER.test(ua)) return false;
  return PREVIEW_UA.test(ua);
}
