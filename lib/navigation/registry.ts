/**
 * The Global Navigation registry — every destination, command and workspace.
 *
 * POPULATION RULE, same as the Product Genome: an entry exists only if its route
 * exists. `navigation.test.ts` walks the real App Router tree and fails on any
 * `href` that does not resolve, so a destination cannot outlive the page it points
 * at. Nav that 404s is the chrome-level version of a claim we can't honour.
 */
import {
  Bookmark,
  Cloud,
  Compass,
  CreditCard,
  Download,
  Film,
  FileText,
  GraduationCap,
  Home,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  MessageCircle,
  Moon,
  Newspaper,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";

import { adminOnly, everyone, proOnly } from "@/lib/platform/module-registry";

import type { Command, Destination, Workspace } from "./types";

/* -------------------------------- workspaces -------------------------------- */

/**
 * All eleven from the brief are DECLARED; `availableWorkspaces()` in queries.ts
 * filters to the ones whose product is claimable, which today is two.
 *
 * Declaring the unbuilt ones costs nothing and keeps the switcher's shape stable as
 * products ship. Offering them would be the Workspace Switcher making the same
 * promise the product grid was making before the Reality Ledger — which is why the
 * filter is in the query layer, not left to each caller to remember.
 */
export const WORKSPACES: Workspace[] = [
  {
    id: "social",
    name: "Social",
    tagline: "Your feed, reels, stories and messages.",
    icon: Users,
    accent: "from-fuchsia-500 to-violet-600",
    home: "/home",
    productId: "community",
    canAccess: everyone,
  },
  {
    id: "creator",
    name: "Creator",
    tagline: "Save, publish and grow an audience.",
    icon: Film,
    accent: "from-blue-600 to-violet-600",
    home: "/downloads",
    productId: "download",
    canAccess: everyone,
  },
  {
    id: "developer",
    name: "Developer",
    tagline: "API keys, docs and integration.",
    icon: KeyRound,
    accent: "from-slate-600 to-slate-800",
    home: "/developers",
    productId: "download",
    canAccess: proOnly,
  },
  // Declared, not yet offered — no product backs these.
  { id: "cloud", name: "Cloud", tagline: "Your synced library.", icon: Cloud, accent: "from-cyan-500 to-blue-600", home: "/cloud", productId: "cloud", canAccess: everyone },
  { id: "ai", name: "Smart", tagline: "Summaries, captions, smarter search.", icon: Sparkles, accent: "from-violet-500 to-purple-600", home: "/smart", productId: "smart", canAccess: everyone },
  { id: "business", name: "Business", tagline: "Team plans and analytics.", icon: CreditCard, accent: "from-emerald-500 to-teal-600", home: "/business", productId: "business", canAccess: proOnly },
  { id: "marketplace", name: "Marketplace", tagline: "Buy and sell resources.", icon: LayoutGrid, accent: "from-amber-500 to-orange-600", home: "/marketplace", productId: "marketplace", canAccess: everyone },
  { id: "professional", name: "Professional", tagline: "Advanced production tools.", icon: Wand2, accent: "from-rose-500 to-pink-600", home: "/professional", productId: "studio", canAccess: proOnly },
  { id: "community", name: "Communities", tagline: "Groups and shared spaces.", icon: Compass, accent: "from-indigo-500 to-blue-600", home: "/communities", productId: "community-groups", canAccess: everyone },
  { id: "learning", name: "Learning", tagline: "Academy, guides and tutorials.", icon: Newspaper, accent: "from-sky-500 to-cyan-600", home: "/learn", productId: "learning", canAccess: everyone },
  { id: "enterprise", name: "Enterprise", tagline: "Org controls and compliance.", icon: Shield, accent: "from-zinc-600 to-zinc-800", home: "/enterprise", productId: "enterprise", canAccess: adminOnly },
];

/* ------------------------------- destinations ------------------------------- */

/**
 * `keywords` carry real synonyms, not restated labels. A palette that only matches
 * the word already on screen helps the people who least need it; "logout", "dark
 * mode" and "api key" are what visitors actually type.
 */
export const DESTINATIONS: Destination[] = [
  { id: "home", label: "Home", href: "/home", kind: "page", icon: Home, workspace: "social", keywords: ["feed", "timeline", "for you"], canAccess: everyone, requiresAuth: true },
  { id: "explore", label: "Explore", href: "/explore", kind: "page", icon: Compass, workspace: "social", keywords: ["discover", "browse", "trending"], canAccess: everyone },
  { id: "reels", label: "Reels", href: "/reels", kind: "page", icon: Film, workspace: "social", keywords: ["videos", "shorts", "watch"], canAccess: everyone },
  { id: "messages", label: "Messages", href: "/messages", kind: "page", icon: MessageCircle, workspace: "social", keywords: ["chat", "dm", "inbox", "conversations"], canAccess: everyone, requiresAuth: true },
  { id: "friends", label: "Friends", href: "/friends", kind: "page", icon: Users, workspace: "social", keywords: ["people", "following", "followers", "connections"], canAccess: everyone, requiresAuth: true },
  { id: "notifications", label: "Notifications", href: "/notifications", kind: "page", icon: LifeBuoy, workspace: "social", keywords: ["alerts", "activity"], canAccess: everyone, requiresAuth: true },

  { id: "downloads", label: "Downloads", href: "/downloads", kind: "product", icon: Download, workspace: "creator", keywords: ["save", "history", "library", "files"], canAccess: everyone },
  { id: "saved", label: "Saved", href: "/saved", kind: "page", icon: Bookmark, workspace: "creator", keywords: ["bookmarks", "collections", "favourites", "favorites"], canAccess: everyone, requiresAuth: true },
  { id: "search", label: "Search", href: "/search", kind: "page", icon: Search, keywords: ["find", "look up"], canAccess: everyone },

  { id: "create-post", label: "Create post", href: "/create/post", kind: "create", icon: ImageIcon, workspace: "social", keywords: ["new post", "publish", "share"], canAccess: everyone, requiresAuth: true },
  { id: "create-reel", label: "Create reel", href: "/create/reel", kind: "create", icon: Film, workspace: "social", keywords: ["new reel", "video", "upload"], canAccess: everyone, requiresAuth: true },
  { id: "create-story", label: "Create story", href: "/create/story", kind: "create", icon: Sparkles, workspace: "social", keywords: ["new story", "24 hours"], canAccess: everyone, requiresAuth: true },

  { id: "account", label: "Account settings", href: "/account", kind: "account", icon: Settings, keywords: ["profile", "preferences", "settings", "privacy", "password", "security"], canAccess: everyone, requiresAuth: true },
  { id: "pricing", label: "Pricing", href: "/pricing", kind: "page", icon: CreditCard, keywords: ["upgrade", "pro", "plans", "billing", "subscription"], canAccess: everyone },
  { id: "developers", label: "Developer API", href: "/developers", kind: "docs", icon: KeyRound, workspace: "developer", keywords: ["api", "docs", "keys", "integration", "rest"], canAccess: everyone },
  { id: "learn", label: "Learning Academy", href: "/learn", kind: "docs", icon: GraduationCap, workspace: "learning", keywords: ["guides", "tutorials", "how to", "help", "academy", "learn", "editing", "subtitles", "captions", "quality"], canAccess: everyone },
  /*
    Academy, Trust Center and Glossary. Registering them here is what puts them in
    the mobile menu and ⌘K — both are views over this registry, so a page absent
    from it is unreachable by navigation no matter how many routes exist.
    That is precisely how these three shipped invisible.

    Keywords matter more than labels here. Nobody types "Trust Center" — they type
    "delete account", "is my profile private", "block someone". The entry has to
    answer the question the user actually has.
  */
  { id: "academy", label: "Academy", href: "/academy", kind: "docs", icon: GraduationCap, workspace: "learning", keywords: ["school", "course", "curriculum", "learn", "creator", "community", "security", "developer", "training"], canAccess: everyone },
  { id: "trust", label: "Trust Center", href: "/trust", kind: "docs", icon: Shield, keywords: ["security", "privacy", "safety", "delete account", "export data", "block", "report", "appeal", "passkey", "2fa", "who can see"], canAccess: everyone },
  { id: "glossary", label: "Glossary", href: "/glossary", kind: "docs", icon: FileText, keywords: ["definition", "meaning", "jargon", "bitrate", "rendition", "captions", "watermark", "what is"], canAccess: everyone },
  { id: "blog", label: "Blog", href: "/blog", kind: "docs", icon: Newspaper, keywords: ["news", "articles", "updates"], canAccess: everyone },
  { id: "contact", label: "Support", href: "/contact", kind: "docs", icon: LifeBuoy, keywords: ["help", "contact", "support", "problem", "bug"], canAccess: everyone },
  { id: "terms", label: "Terms of Service", href: "/terms", kind: "docs", icon: FileText, keywords: ["legal", "tos"], canAccess: everyone },
  { id: "privacy", label: "Privacy Policy", href: "/privacy", kind: "docs", icon: Shield, keywords: ["legal", "data", "gdpr"], canAccess: everyone },

  { id: "admin", label: "Admin dashboard", href: "/admin", kind: "admin", icon: Shield, keywords: ["operate", "moderation", "stats"], canAccess: adminOnly, requiresAuth: true },
  { id: "admin-content", label: "Content operations", href: "/admin/content", kind: "admin", icon: FileText, keywords: ["sync", "genome", "graph", "drift", "content"], canAccess: adminOnly, requiresAuth: true },
];

/* --------------------------------- commands --------------------------------- */

export const COMMANDS: Command[] = [
  { id: "cmd-download", label: "Download a video", href: "/#download", icon: Download, group: "create", keywords: ["paste", "link", "url", "save video", "grab"], hint: "Paste a link on the home page", canAccess: everyone },
  { id: "cmd-post", label: "New post", href: "/create/post", icon: ImageIcon, group: "create", keywords: ["publish", "share", "upload"], canAccess: everyone, requiresAuth: true },
  { id: "cmd-reel", label: "New reel", href: "/create/reel", icon: Film, group: "create", keywords: ["video", "short"], canAccess: everyone, requiresAuth: true },
  { id: "cmd-story", label: "New story", href: "/create/story", icon: Sparkles, group: "create", keywords: ["24 hours", "ephemeral"], canAccess: everyone, requiresAuth: true },

  { id: "cmd-theme", label: "Toggle light / dark", action: "toggle-theme", icon: Moon, group: "appearance", keywords: ["dark mode", "light mode", "theme", "appearance", "night"], canAccess: everyone },
  { id: "cmd-install", label: "Install the app", action: "install-app", icon: LayoutGrid, group: "appearance", keywords: ["pwa", "add to home screen", "install"], hint: "Add Frenz to your home screen", canAccess: everyone },
  { id: "cmd-copy", label: "Copy link to this page", action: "copy-link", icon: FileText, group: "account", keywords: ["share", "url", "copy"], canAccess: everyone },

  { id: "cmd-account", label: "Account settings", href: "/account", icon: Settings, group: "account", keywords: ["profile", "preferences", "security"], canAccess: everyone, requiresAuth: true },
  { id: "cmd-upgrade", label: "Upgrade to Pro", href: "/pricing", icon: CreditCard, group: "account", keywords: ["billing", "subscription", "remove ads", "premium"], canAccess: everyone },
  { id: "cmd-signout", label: "Sign out", action: "sign-out", icon: LogOut, group: "account", keywords: ["logout", "log out", "leave"], canAccess: everyone, requiresAuth: true },

  { id: "cmd-admin", label: "Admin dashboard", href: "/admin", icon: Shield, group: "admin", keywords: ["operate", "moderate"], canAccess: adminOnly, requiresAuth: true },
  { id: "cmd-sync", label: "Content drift report", href: "/admin/content", icon: FileText, group: "admin", keywords: ["sync", "findings", "genome", "graph"], canAccess: adminOnly, requiresAuth: true },
];
