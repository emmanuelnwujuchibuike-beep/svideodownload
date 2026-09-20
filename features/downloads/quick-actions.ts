import { Bookmark, Heart, Image as ImageIcon, Sparkles, type LucideIcon } from "lucide-react";

/**
 * The quick actions — ONE list, read by the in-page grid on /downloads and by
 * the sheet the hero's Quick actions button opens (owner, 2026-09-20). Two
 * copies of this list would be the "Soon" bug again: the Frenz AI tile read
 * "Soon" for days after the route existed because the label lived in a
 * second place nobody updated.
 *
 * Every entry is a real destination. There is no `soon` flag any more (owner,
 * 2026-09-20: "remove the soon button from the quick action card and modal")
 * — a product that does not exist yet is simply not listed, which is the
 * profile-doorway rule stated the other way round.
 */
export interface QuickAction {
  id: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  href: string;
  /** The icon tile's gradient, light and dark, as Tailwind classes (literal, so the scanner sees them). */
  tile: string;
  /** The hover glow behind a card, matching its tile. */
  glow: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  // "Browse full screen" means exactly that, so it skips the grid and opens
  // the reels viewer directly (`?reels=1`) — the behaviour this card has
  // always had, kept on the one wallpaper route.
  {
    id: "wallpapers",
    icon: ImageIcon,
    title: "Wallpapers",
    sub: "Browse full screen",
    href: "/wallpapers?reels=1",
    tile: "from-fuchsia-500 to-pink-500 shadow-fuchsia-500/30",
    glow: "bg-fuchsia-500/20",
  },
  {
    id: "favorites",
    icon: Heart,
    title: "Favorites",
    sub: "View saved items",
    href: "/history?filter=favorites",
    tile: "from-rose-500 to-orange-400 shadow-rose-500/30",
    glow: "bg-rose-500/20",
  },
  {
    id: "saved",
    icon: Bookmark,
    title: "Saved posts",
    sub: "Your bookmarks",
    href: "/saved",
    tile: "from-blue-500 to-cyan-400 shadow-blue-500/30",
    glow: "bg-blue-500/20",
  },
  /*
    Owner, 2026-09-07: "the ai studio button in download page still shows soon
    and the name is suppose to be frenz ai not ai studio." The product is
    named Frenz AI and lives at /studio/ai; a signed-out visitor is sent
    through sign-in, which is the feature's actual gate.
  */
  {
    id: "frenz-ai",
    icon: Sparkles,
    title: "Frenz AI",
    sub: "AI tools for your videos",
    href: "/studio/ai",
    tile: "from-violet-500 to-blue-600 shadow-violet-500/30",
    glow: "bg-violet-500/20",
  },
];
