import type { IconType } from "react-icons";
import { FaLinkedin } from "react-icons/fa";
import {
  SiFacebook,
  SiInstagram,
  SiPinterest,
  SiReddit,
  SiSnapchat,
  SiThreads,
  SiTiktok,
  SiVimeo,
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
  youtube: SiYoutube,
  threads: SiThreads,
  snapchat: SiSnapchat,
  linkedin: FaLinkedin,
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
