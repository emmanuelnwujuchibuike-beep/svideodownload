import {
  Clapperboard,
  Cloud,
  Compass,
  FolderTree,
  GraduationCap,
  Image as ImageIcon,
  Languages,
  MessageCircle,
  Mic,
  Music,
  Send,
  ShoppingBag,
  Sparkles,
  Subtitles,
  Wand2,
} from "lucide-react";

import type { DownloadContext, GatewayAction } from "./types";

/**
 * The Discovery Gateway™ action catalogue — every destination the Download Hub
 * brief asks for, declared as data. See `docs/DOWNLOAD_HUB_RFC.md` §3.
 *
 * Eight of these point at products that do not exist yet. That is deliberate and
 * safe: `resolveAvailability` (in `recommend.ts`) derives each one's state from the
 * Product Genome, and a `planned` action renders in future tense with a real
 * waitlist — never as a live CTA. Declaring them now means the day Studio ships,
 * the Gateway starts recommending it with no change to this file or any other.
 *
 * To add a destination: add one entry. Do not add an `availability` field — it is
 * derived, and `reality-ledger.test.ts` will fail if a `planned` action is dressed
 * up as a live one.
 */

/* ------------------------------ fit helpers ------------------------------- */

/** Long enough that someone plausibly wants captions or a summary. */
const isSpokenVideo = (c: DownloadContext) =>
  c.kind === "video" && c.hasAudio && c.durationSec >= 45;

/** Short vertical clip — the shape people repost rather than edit. */
const isShortForm = (c: DownloadContext) =>
  c.kind === "video" && c.durationSec > 0 && c.durationSec <= 90;

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/* -------------------------------- catalogue ------------------------------- */

export const GATEWAY_ACTIONS: GatewayAction[] = [
  /* ---------------------------- LIVE: community --------------------------- */
  {
    id: "send-to-chat",
    label: "Send to a chat",
    plannedLabel: "Send to a chat",
    description: "Share it from your library into a Frenz conversation.",
    icon: Send,
    group: "share",
    productId: "community",
    // Routes to the library rather than opening a sheet here, because the
    // send-to-chat sheet needs the downloaded blob and only the library player
    // holds one. Sending the user where the capability actually lives beats
    // duplicating the blob plumbing into a panel that renders mid-flow.
    target: { type: "route", href: "/downloads" },
    base: 82,
    requiresAuth: true,
    // Sharing is the most common real next step, and it is genuinely better for
    // short clips — nobody forwards a 40-minute file into a chat.
    fit: (c) => (isShortForm(c) ? 1 : c.kind === "image" ? 0.85 : 0.5),
  },
  {
    id: "publish-reel",
    label: "Post as a reel",
    plannedLabel: "Post as a reel",
    description: "Publish vertical video to your profile.",
    icon: Clapperboard,
    group: "create",
    productId: "community",
    target: { type: "route", href: "/create/reel" },
    base: 78,
    requiresAuth: true,
    fit: (c) => {
      if (c.kind !== "video") return 0;
      // Reels are vertical short-form. Height alone can't prove aspect ratio, but
      // duration is a strong enough signal on its own.
      return isShortForm(c) ? 1 : 0.3;
    },
  },
  {
    id: "publish-post",
    label: "Share as a post",
    plannedLabel: "Share as a post",
    description: "Add it to your feed with a caption.",
    icon: ImageIcon,
    group: "create",
    productId: "community",
    target: { type: "route", href: "/create/post" },
    base: 70,
    requiresAuth: true,
    fit: (c) => (c.kind === "image" ? 1 : c.kind === "video" ? 0.7 : 0.25),
  },
  {
    id: "publish-story",
    label: "Add to your story",
    plannedLabel: "Add to your story",
    description: "Share it for 24 hours.",
    icon: Sparkles,
    group: "create",
    productId: "community",
    target: { type: "route", href: "/create/story" },
    base: 64,
    requiresAuth: true,
    fit: (c) => (isShortForm(c) || c.kind === "image" ? 0.9 : 0.3),
  },
  {
    id: "explore-community",
    label: "See what people are sharing",
    plannedLabel: "See what people are sharing",
    description: "Browse reels and posts from other creators.",
    icon: Compass,
    group: "share",
    productId: "community",
    target: { type: "route", href: "/explore" },
    base: 46,
    requiresAuth: false,
    // The one recommendation aimed squarely at a first-time anonymous visitor:
    // they have their file, and this is the cheapest possible look at the rest.
    fit: (c) => (c.downloadCount <= 1 ? 0.95 : 0.35),
  },
  {
    id: "open-messages",
    label: "Open Messages",
    plannedLabel: "Open Messages",
    description: "Pick up a conversation.",
    icon: MessageCircle,
    group: "share",
    productId: "community",
    target: { type: "route", href: "/messages" },
    base: 30,
    requiresAuth: true,
    fit: () => 0.4,
  },

  /* ------------------------- PLANNED: Frenz Studio ------------------------ */
  {
    id: "edit-video",
    label: "Trim and edit",
    plannedLabel: "Trim and edit — coming soon",
    description: "Cut, crop and remix what you saved.",
    icon: Wand2,
    group: "enhance",
    productId: "studio",
    target: { type: "waitlist", product: "studio" },
    base: 76,
    requiresAuth: false,
    fit: (c) => (c.kind === "video" ? 1 : c.kind === "image" ? 0.5 : 0.2),
  },
  {
    id: "enhance-quality",
    label: "Enhance quality",
    plannedLabel: "Quality enhancement — coming soon",
    description: "Sharpen and upscale lower-resolution media.",
    icon: Sparkles,
    group: "enhance",
    productId: "studio",
    target: { type: "waitlist", product: "studio" },
    base: 58,
    requiresAuth: false,
    // Only meaningful when the source is actually low-res. Recommending an
    // upscaler for 1080p is noise.
    fit: (c) => {
      if (c.kind === "audio") return 0;
      if (c.height === 0) return 0.3;
      return clamp((720 - c.height) / 480);
    },
  },
  {
    id: "make-thumbnail",
    label: "Create a thumbnail",
    plannedLabel: "Thumbnail maker — coming soon",
    description: "Pull a frame and turn it into cover art.",
    icon: ImageIcon,
    group: "enhance",
    productId: "studio",
    target: { type: "waitlist", product: "studio" },
    base: 52,
    requiresAuth: false,
    fit: (c) => (c.kind === "video" && c.durationSec >= 30 ? 0.8 : 0.2),
  },
  {
    id: "extract-audio",
    label: "Extract the audio",
    plannedLabel: "Audio tools — coming soon",
    description: "Pull a clean audio track out of the video.",
    icon: Music,
    group: "enhance",
    productId: "studio",
    target: { type: "waitlist", product: "studio" },
    base: 44,
    requiresAuth: false,
    // The downloader already offers MP3 at format-selection time, so this is only
    // worth surfacing to someone who took the video and might want both.
    fit: (c) => (c.kind === "video" && c.hasAudio ? 0.6 : 0),
  },
  {
    id: "voice-over",
    label: "Record a voice-over",
    plannedLabel: "Voice tools — coming soon",
    description: "Narrate over your clip.",
    icon: Mic,
    group: "enhance",
    productId: "studio",
    target: { type: "waitlist", product: "studio" },
    base: 34,
    requiresAuth: false,
    fit: (c) => (c.kind === "video" ? 0.5 : 0),
  },

  /* -------------------------- PLANNED: Frenz Smart ------------------------ */
  {
    id: "generate-subtitles",
    label: "Generate subtitles",
    plannedLabel: "Auto subtitles — coming soon",
    description: "Transcribe speech into timed captions.",
    icon: Subtitles,
    group: "enhance",
    productId: "smart",
    target: { type: "waitlist", product: "smart" },
    base: 72,
    requiresAuth: false,
    fit: (c) => {
      if (!c.hasAudio) return 0;
      if (c.kind === "audio") return 0.7;
      return isSpokenVideo(c) ? 1 : 0.25;
    },
  },
  {
    id: "translate-subtitles",
    label: "Translate the captions",
    plannedLabel: "Caption translation — coming soon",
    description: "Reach an audience in another language.",
    icon: Languages,
    group: "enhance",
    productId: "smart",
    target: { type: "waitlist", product: "smart" },
    base: 50,
    requiresAuth: false,
    fit: (c) => (isSpokenVideo(c) ? 0.75 : 0),
  },

  /* -------------------------- PLANNED: Frenz Cloud ------------------------ */
  {
    id: "save-to-cloud",
    label: "Save to your cloud",
    plannedLabel: "Cloud storage — coming soon",
    description: "Keep it synced across every device.",
    icon: Cloud,
    group: "store",
    productId: "cloud",
    target: { type: "waitlist", product: "cloud" },
    base: 68,
    requiresAuth: true,
    // Value rises with how much someone has saved — a library is what makes sync
    // worth having.
    fit: (c) => clamp(0.4 + c.downloadCount / 25),
  },
  {
    id: "organize-project",
    label: "Add to a project",
    plannedLabel: "Projects — coming soon",
    description: "Group related media into a working set.",
    icon: FolderTree,
    group: "store",
    productId: "cloud",
    target: { type: "waitlist", product: "cloud" },
    base: 48,
    requiresAuth: true,
    fit: (c) => clamp(c.downloadCount / 12),
  },

  /* ------------------------ PLANNED: undeclared products ------------------ */
  {
    id: "marketplace",
    label: "Browse the marketplace",
    plannedLabel: "Marketplace — coming soon",
    description: "Templates, presets and sounds from other creators.",
    icon: ShoppingBag,
    group: "store",
    // No genome entry exists for this at all. `resolveAvailability` treats an
    // unknown product as `planned`, which is the correct fail-closed default.
    productId: "marketplace",
    target: { type: "waitlist", product: "marketplace" },
    base: 28,
    requiresAuth: false,
    fit: () => 0.4,
  },
  {
    id: "learn",
    label: "Learn how to do more with this",
    plannedLabel: "Learn how to do more with this",
    description: "Short guides on editing, captions and publishing.",
    icon: GraduationCap,
    group: "learn",
    productId: "learning",
    target: { type: "route", href: "/learn" },
    base: 40,
    requiresAuth: false,
    fit: (c) => (c.downloadCount <= 3 ? 0.8 : 0.45),
  },
];

export function getAction(id: string): GatewayAction | undefined {
  return GATEWAY_ACTIONS.find((a) => a.id === id);
}
