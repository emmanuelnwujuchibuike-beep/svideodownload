import type { Platform, PlatformId } from "@/types";

/**
 * Registry of supported platforms. TikTok is intentionally first — it is the
 * flagship platform for SVideoDownload. The `generic` entry is the fallback
 * for any other URL that yt-dlp can still handle.
 */
export const PLATFORMS: Record<PlatformId, Platform> = {
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
    accent: "from-pink-500 via-rose-500 to-cyan-400",
    watermarkFree: true,
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    hosts: ["instagram.com", "instagr.am"],
    accent: "from-fuchsia-500 via-purple-500 to-amber-400",
    watermarkFree: true,
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    hosts: ["facebook.com", "fb.watch", "fb.com"],
    accent: "from-blue-600 to-sky-500",
    watermarkFree: false,
  },
  twitter: {
    id: "twitter",
    name: "X (Twitter)",
    hosts: ["twitter.com", "x.com", "t.co"],
    accent: "from-zinc-700 to-zinc-900",
    watermarkFree: true,
  },
  pinterest: {
    id: "pinterest",
    name: "Pinterest",
    hosts: ["pinterest.com", "pin.it"],
    accent: "from-red-600 to-rose-500",
    watermarkFree: false,
  },
  reddit: {
    id: "reddit",
    name: "Reddit",
    hosts: ["reddit.com", "redd.it", "v.redd.it"],
    accent: "from-orange-500 to-red-500",
    watermarkFree: false,
  },
  vimeo: {
    id: "vimeo",
    name: "Vimeo",
    hosts: ["vimeo.com"],
    accent: "from-sky-500 to-cyan-500",
    watermarkFree: false,
  },
  dailymotion: {
    id: "dailymotion",
    name: "Dailymotion",
    hosts: ["dailymotion.com", "dai.ly"],
    accent: "from-blue-500 to-indigo-500",
    watermarkFree: false,
  },
  twitch: {
    id: "twitch",
    name: "Twitch Clips",
    hosts: ["twitch.tv", "clips.twitch.tv"],
    accent: "from-purple-600 to-violet-500",
    watermarkFree: false,
  },
  soundcloud: {
    id: "soundcloud",
    name: "SoundCloud",
    hosts: ["soundcloud.com"],
    accent: "from-orange-500 to-amber-400",
    watermarkFree: false,
    audioOnly: true,
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    hosts: ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"],
    accent: "from-red-600 to-red-500",
    watermarkFree: false,
  },
  threads: {
    id: "threads",
    name: "Threads",
    hosts: ["threads.net"],
    accent: "from-zinc-700 to-black",
    watermarkFree: true,
  },
  snapchat: {
    id: "snapchat",
    name: "Snapchat Spotlight",
    hosts: ["snapchat.com"],
    accent: "from-yellow-300 to-yellow-400",
    watermarkFree: false,
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    hosts: ["linkedin.com", "lnkd.in"],
    accent: "from-sky-700 to-blue-600",
    watermarkFree: false,
  },
  bilibili: {
    id: "bilibili",
    name: "Bilibili",
    hosts: ["bilibili.com", "b23.tv"],
    accent: "from-cyan-400 to-pink-400",
    watermarkFree: false,
  },
  vk: {
    id: "vk",
    name: "VK",
    hosts: ["vk.com", "vkvideo.ru"],
    accent: "from-blue-600 to-sky-600",
    watermarkFree: false,
  },
  generic: {
    id: "generic",
    name: "Web Video",
    hosts: [],
    accent: "from-emerald-500 to-teal-500",
    watermarkFree: false,
  },
};

/** Ordered list for UI rendering (flagship first, generic excluded). */
export const SHOWCASE_PLATFORMS: Platform[] = Object.values(PLATFORMS).filter(
  (p) => p.id !== "generic",
);

function normalizeHost(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

/**
 * Detects which supported platform a URL belongs to. Returns the `generic`
 * platform when the host is not explicitly mapped — yt-dlp may still handle it.
 */
export function detectPlatform(rawUrl: string): Platform {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return PLATFORMS.generic;
  }

  const host = normalizeHost(url.hostname);

  for (const platform of Object.values(PLATFORMS)) {
    if (platform.id === "generic") continue;
    if (platform.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return platform;
    }
  }

  return PLATFORMS.generic;
}

export function getPlatform(id: PlatformId): Platform {
  return PLATFORMS[id];
}
