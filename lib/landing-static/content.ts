import { FAQS } from "@/components/landing/faq-data";
import { PLATFORMS, SHOWCASE_PLATFORMS } from "@/lib/platforms";
import { getPrimaryPageForPlatform } from "@/lib/seo/seo-pages";
import type { PlatformId } from "@/types";

/**
 * What the static landing page says, from the app's own sources — never a second copy that can drift:
 *   platforms   lib/platforms.ts (the same list the backend's detectPlatform uses), minus "generic"
 *   FAQ         components/landing/faq-data.ts (the same questions the old landing and its JSON-LD used)
 *   tool links  lib/seo/seo-pages.ts — one downloader page per platform, which is also where the landing hands a
 *               link over for the things only the full downloader does (a top-quality file behind the reward ad,
 *               a multi-item batch)
 */

export interface LandingPlatform {
  id: PlatformId;
  name: string;
  hosts: string[];
  /** the platform's downloader page, when one exists */
  page: string | null;
  /** listed on the page ("Works with", the platforms sheet, the downloader links)? YouTube is supported but never
   *  promoted (lib/platforms.ts SHOWCASE_PLATFORMS — the AdSense rule); its links are still recognised. */
  shown: boolean;
}

/** One downloader page per platform: its canonical one (the same the platform cards link to). */
function pageFor(id: PlatformId): string | null {
  const page = getPrimaryPageForPlatform(id);
  return page ? `/${page.slug}` : null;
}

/** The order the design shows first ("Works with TikTok · Instagram · X · Snapchat"), then the rest as listed. */
const FIRST: PlatformId[] = ["tiktok", "instagram", "twitter", "snapchat"];

export function landingPlatforms(): LandingPlatform[] {
  const all = (Object.values(PLATFORMS) as { id: PlatformId; name: string; hosts: string[] }[]).filter((p) => p.id !== "generic" && p.hosts.length > 0);
  const ordered = [...FIRST.map((id) => all.find((p) => p.id === id)).filter((p): p is (typeof all)[number] => !!p), ...all.filter((p) => !FIRST.includes(p.id))];
  const showcase = new Set(SHOWCASE_PLATFORMS.map((p) => p.id));
  return ordered.map((p) => ({ id: p.id, name: p.id === "twitter" ? "X" : p.id === "snapchat" ? "Snapchat" : p.name, hosts: p.hosts, page: pageFor(p.id), shown: showcase.has(p.id) }));
}

export const landingFaq = FAQS;

/**
 * What's new — dated. Frenz AI shipped 2026-09-07 (git: "Frenz AI — the media-tools foundation"). Sticker gifts and
 * the new Creator analytics ship with THIS release: RELEASE_DATE is the day they were built and must be moved to the
 * real go-live day if the release goes out later.
 */
export const RELEASE_DATE = "2026-10-27";
export const WHATS_NEW: { date: string; title: string; text: string }[] = [
  { date: RELEASE_DATE, title: "Sticker gifts", text: "Send a sticker to a friend in chat, paid with Gift Coins." },
  { date: RELEASE_DATE, title: "New Creator analytics", text: "See engagement, exclusive post earnings and gifts in one dashboard." },
  { date: "2026-09-07", title: "Frenz AI", text: "Create images and short videos from a prompt." },
];

export const whatsNewDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
