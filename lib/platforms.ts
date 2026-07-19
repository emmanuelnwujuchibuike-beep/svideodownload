import type { Platform, PlatformId } from "@/types";

/**
 * Registry of supported platforms. TikTok is intentionally first — it is the
 * flagship platform for FrenzSave. The `generic` entry is the fallback
 * for any other URL that yt-dlp can still handle.
 */
export const PLATFORMS: Record<PlatformId, Platform> = {
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
    // Authentic TikTok look: black with the logo (it is NOT red).
    accent: "from-neutral-900 to-black",
    accentForeground: "light",
    watermarkFree: true,
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    hosts: ["instagram.com", "instagr.am"],
    /*
     * Instagram's official gradient runs yellow → orange → pink → purple → blue.
     * It starts at the ORANGE stop here rather than the pale yellow #feda75,
     * which measures 3.19:1 against white even under the hero scrim — below the
     * 4.5:1 AA floor for the tagline. Every remaining stop clears 8:1, and the
     * ramp still reads unmistakably as Instagram.
     */
    accent: "from-[#f77737] via-[#d62976] to-[#4f5bd5]",
    accentForeground: "light",
    watermarkFree: true,
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    hosts: ["facebook.com", "fb.watch", "fb.com"],
    accent: "from-[#0866ff] to-[#1d4ed8]",
    accentForeground: "light",
    watermarkFree: false,
  },
  twitter: {
    id: "twitter",
    name: "X (Twitter)",
    hosts: ["twitter.com", "x.com", "t.co"],
    accent: "from-zinc-700 to-black",
    accentForeground: "light",
    watermarkFree: true,
  },
  pinterest: {
    id: "pinterest",
    name: "Pinterest",
    hosts: ["pinterest.com", "pin.it"],
    accent: "from-[#e60023] to-[#ad081b]",
    accentForeground: "light",
    watermarkFree: false,
  },
  reddit: {
    id: "reddit",
    name: "Reddit",
    hosts: ["reddit.com", "redd.it", "v.redd.it"],
    accent: "from-[#ff4500] to-[#ff8717]",
    accentForeground: "light",
    watermarkFree: false,
  },
  vimeo: {
    id: "vimeo",
    name: "Vimeo",
    hosts: ["vimeo.com"],
    accent: "from-[#1ab7ea] to-[#0d6df0]",
    accentForeground: "light",
    watermarkFree: false,
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    hosts: ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"],
    accent: "from-[#ff0000] to-[#cc0000]",
    accentForeground: "light",
    watermarkFree: false,
  },
  threads: {
    id: "threads",
    name: "Threads",
    hosts: ["threads.net", "threads.com"],
    accent: "from-zinc-700 to-black",
    accentForeground: "light",
    watermarkFree: true,
  },
  snapchat: {
    id: "snapchat",
    name: "Snapchat Spotlight",
    hosts: ["snapchat.com"],
    accent: "from-[#fffc00] to-[#f7b500]",
    /*
     * The only dark-foreground brand, and it is not a style preference —
     * #fffc00 against white measures 1.10:1 where WCAG AA wants 4.5:1. Even a
     * 45% black scrim only reaches 3.62:1. Black on Snapchat yellow is both
     * legible (19.18:1) and authentic to the brand.
     */
    accentForeground: "dark",
    watermarkFree: false,
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    hosts: ["linkedin.com", "lnkd.in"],
    accent: "from-[#0a66c2] to-[#004182]",
    accentForeground: "light",
    watermarkFree: false,
  },
  generic: {
    id: "generic",
    name: "Web Video",
    hosts: [],
    accent: "from-emerald-500 to-teal-500",
    accentForeground: "light",
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
