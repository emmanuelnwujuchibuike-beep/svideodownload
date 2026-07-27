import {
  Bookmark,
  Clapperboard,
  Cloud,
  Compass,
  DollarSign,
  Download,
  Film,
  Home,
  type LucideIcon,
  MessageCircle,
  Newspaper,
  Package,
  Radio,
  TrendingUp,
  Users,
} from "lucide-react";

/**
 * The dashboard's primary navigation, shared by the desktop sidebar and the
 * mobile menu drawer so the two can never disagree. `href` set → the route is
 * built and navigates; `href` omitted → the feature isn't built yet, so it
 * announces "coming soon" instead of dead-ending.
 */
export type NavRow = { label: string; icon: LucideIcon; href?: string; badge?: string; live?: boolean };

export const PRIMARY: NavRow[] = [
  { label: "Home", icon: Home, href: "/home" },
  { label: "Explore", icon: Compass, href: "/explore" },
  { label: "Trending", icon: TrendingUp, href: "/explore?sort=trending" },
  { label: "Reels", icon: Film, href: "/reels" },
  { label: "News", icon: Newspaper, href: "/blog" },
  { label: "Communities", icon: Users },
  { label: "Friends", icon: Users, href: "/friends" },
  { label: "Chats", icon: MessageCircle, href: "/messages", badge: "8" },
  { label: "Downloads", icon: Download, href: "/downloads" },
  { label: "Saved", icon: Bookmark, href: "/saved" },
];

export const SPACES: NavRow[] = [
  { label: "My Cloud", icon: Cloud },
  { label: "My Studio", icon: Clapperboard },
  { label: "My Products", icon: Package },
  { label: "My Earnings", icon: DollarSign },
  { label: "My Live", icon: Radio, live: true },
];
