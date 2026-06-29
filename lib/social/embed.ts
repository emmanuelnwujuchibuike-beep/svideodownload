import type { MediaKind } from "@/lib/social/posts";

/**
 * Resolves how a published post should play *in place* (no media re-hosting):
 * - `iframe` → an official platform embed that can autoplay inline.
 * - `image`  → render the full image (photo posts).
 * - `none`   → no inline player available (e.g. TikTok/IG often block embeds);
 *              the viewer shows the thumbnail + a "Watch on …" link.
 */
export type EmbedInfo =
  | { kind: "iframe"; url: string }
  | { kind: "image" }
  | { kind: "none" };

function youtubeId(url: string): string | null {
  const m =
    url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([\w-]{11})/i) ??
    url.match(/[?&]v=([\w-]{11})/i);
  return m?.[1] ?? null;
}
function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  return m?.[1] ?? null;
}
function dailymotionId(url: string): string | null {
  const m = url.match(/dailymotion\.com\/(?:video\/|embed\/video\/)([a-z0-9]+)/i) ?? url.match(/dai\.ly\/([a-z0-9]+)/i);
  return m?.[1] ?? null;
}

export function getEmbed(sourceUrl: string, platform: string, mediaKind: MediaKind): EmbedInfo {
  if (mediaKind === "image") return { kind: "image" };

  const url = sourceUrl.trim();
  const p = platform.toLowerCase();

  const yt = youtubeId(url);
  if (yt && (p.includes("youtube") || /youtu\.?be/i.test(url))) {
    return { kind: "iframe", url: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&playsinline=1` };
  }
  const vi = vimeoId(url);
  if (vi && (p.includes("vimeo") || /vimeo\.com/i.test(url))) {
    return { kind: "iframe", url: `https://player.vimeo.com/video/${vi}?autoplay=1` };
  }
  const dm = dailymotionId(url);
  if (dm) return { kind: "iframe", url: `https://www.dailymotion.com/embed/video/${dm}?autoplay=1` };

  if (p.includes("facebook") || /facebook\.com|fb\.watch/i.test(url)) {
    return { kind: "iframe", url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true` };
  }

  // TikTok, Instagram, X, Snapchat, Pinterest, Reddit, etc. — no reliable
  // inline embed; the viewer falls back to thumbnail + external watch link.
  return { kind: "none" };
}

/** Whether a post can play inline (drives the autoplay-on-tap affordance). */
export function isPlayableInline(sourceUrl: string, platform: string, mediaKind: MediaKind): boolean {
  const e = getEmbed(sourceUrl, platform, mediaKind);
  return e.kind !== "none";
}
