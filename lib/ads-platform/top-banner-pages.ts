import { isProfilePath } from "@/lib/social/profile-url";

/**
 * Where the GLOBAL top banner may show (owner, 2026-10-22: "Global top banner shouldn't show on feed,
 * reels, exclusive, profile, friends, all signed in pages — only the unsigned in pages, download page,
 * earn, Quest and support").
 *
 *   · never on the social surfaces — signed in or not;
 *   · a signed-OUT visitor: every other page;
 *   · a signed-IN member: only Earn, Quests and Support. (The Downloads page has its own top slot,
 *     `downloads_top`, which takes the same paid placement — so it is NOT repeated here.)
 *
 * Pure, so the rule is tested on its own (top-banner-pages.test.ts) and read by TopPageBannerAd in
 * both layouts.
 */

const SOCIAL_PREFIXES = ["/home", "/feed", "/reels", "/exclusive", "/friends", "/messages", "/explore", "/notifications", "/profile", "/u/", "/p/", "/stories"] as const;

/** The signed-in pages that carry it. */
export const TOP_BANNER_MEMBER_PATHS = ["/earn", "/quests", "/support"] as const;

const under = (path: string, prefix: string) => (prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`));

export function isSocialPath(path: string): boolean {
  return SOCIAL_PREFIXES.some((p) => under(path, p)) || isProfilePath(path);
}

export function topBannerAllowed(path: string | null | undefined, signedIn: boolean): boolean {
  const p = path || "/";
  if (isSocialPath(p)) return false;
  // the Downloads page shows the same placement in its own sticky slot
  if (under(p, "/downloads")) return false;
  if (!signedIn) return true;
  return TOP_BANNER_MEMBER_PATHS.some((m) => under(p, m));
}
