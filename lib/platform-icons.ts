import type { IconType } from "react-icons";
import {
  SiBilibili,
  SiDailymotion,
  SiFacebook,
  SiInstagram,
  SiPinterest,
  SiReddit,
  SiSnapchat,
  SiSoundcloud,
  SiThreads,
  SiTiktok,
  SiTwitch,
  SiVimeo,
  SiVk,
  SiX,
  SiYoutube,
} from "react-icons/si";

import type { PlatformId } from "@/types";

/** Real brand logos per platform (shared across hero, flagship, showcase). */
export const BRAND_ICONS: Partial<Record<PlatformId, IconType>> = {
  tiktok: SiTiktok,
  instagram: SiInstagram,
  facebook: SiFacebook,
  twitter: SiX,
  pinterest: SiPinterest,
  reddit: SiReddit,
  vimeo: SiVimeo,
  dailymotion: SiDailymotion,
  twitch: SiTwitch,
  soundcloud: SiSoundcloud,
  youtube: SiYoutube,
  threads: SiThreads,
  snapchat: SiSnapchat,
  bilibili: SiBilibili,
  vk: SiVk,
};

/** The hero/flagship featured platforms, in display order. */
export const FLAGSHIP_IDS: PlatformId[] = [
  "tiktok",
  "twitter",
  "snapchat",
  "instagram",
  "facebook",
  "pinterest",
];

/** Short marketing taglines for the flagship cards. */
export const FLAGSHIP_TAGLINES: Partial<Record<PlatformId, string>> = {
  tiktok: "No-watermark HD videos & sounds",
  twitter: "Save X videos & GIFs instantly",
  snapchat: "Download Spotlight clips",
  instagram: "Reels, posts & stories in HD",
  facebook: "Watch videos & Reels in HD",
  pinterest: "Save video pins effortlessly",
};
