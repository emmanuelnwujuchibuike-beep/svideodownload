/**
 * The admin dashboard's information architecture.
 *
 * ── Why a registry rather than markup order ───────────────────────────────────
 *
 * The dashboard was one 627-line page with fourteen panels stacked in the order
 * they happened to be built, and the order was the only grouping there was.
 * Finding the ad placements meant scrolling past push-delivery statistics.
 *
 * Declaring the structure separately means the nav, the panels and the default
 * view are all derived from one list, so a section cannot exist in the nav and
 * not in the page (or the reverse) — which is the admin equivalent of the
 * unreachable-route defect that has now bitten this project three times.
 *
 * ── Money first, deliberately ─────────────────────────────────────────────────
 *
 * `monetization` is the default section. It is what the operator opens the
 * dashboard to look at, and it was previously the fifth thing down the page.
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE AXIS IS PRODUCTS, NOT DEPARTMENTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "The dashboard is becoming too crowded because Wallpaper,
 * Downloader, and Frenz AI features are currently mixed together… reorganize
 * the entire admin experience into three clearly separated product sections."
 *
 * The previous axis was Money / Audience / Content / System — a functional
 * split, and a reasonable one when there was one product. It stopped working
 * for the reason the owner names: the wallpaper library, the download platform
 * status and the Frenz AI switches all landed under "Content", beside the
 * landing page and the SEO catalogue, because that is what they had in common
 * from the DASHBOARD's point of view rather than from the product's.
 *
 * ── 🔴 THIS IS A RE-CATEGORISATION, NOT A MIGRATION ─────────────────────────
 *
 * Not one panel moves, not one route changes, not one query is rewritten. The
 * nav, the section list and the default view have all been derived from this
 * registry since it was built — so changing the axis here changes the whole
 * information architecture, and the brief's own instruction ("Reuse existing
 * functionality wherever possible. Do NOT rewrite working backend logic
 * unnecessarily. Preserve existing URLs/routes where practical") is satisfied
 * by construction rather than by care.
 *
 * ── Why five groups and not the brief's four ────────────────────────────────
 *
 * The brief lists PRODUCTS / PLATFORM / MONETIZATION / SETTINGS. A fifth,
 * `insight`, holds the things that describe the whole estate rather than any
 * one product — Search & SEO, Media, Notifications, Data, Quality,
 * Engineering. Forcing those into "Settings" would make Settings the new
 * dumping ground, which is the exact failure being fixed.
 *
 * ── 🔴 ADDING A PRODUCT IS ADDING A CATEGORY ────────────────────────────────
 *
 * "if FrenzSave later introduces Frenz Music, Frenz Video, Frenz Studio they
 * should be able to become additional product workspaces without redesigning
 * the entire admin dashboard." They become one entry here and one `category`
 * on their sections. Nothing else.
 */
export type AdminCategoryId =
  | "wallpaper"
  | "downloader"
  | "ai"
  | "platform"
  | "monetization"
  | "insight";

export interface AdminCategory {
  id: AdminCategoryId;
  label: string;
  /**
   * The heading a group sits under in the nav. Products are anchors; the rest
   * are supporting, and the brief is explicit that the three products are "the
   * primary organizational anchors".
   */
  group: "Products" | "Platform" | "Monetization" | "Insight";
}

export const ADMIN_CATEGORIES: AdminCategory[] = [
  /* The three products, first and in the brief's own order. */
  { id: "wallpaper", label: "Wallpaper", group: "Products" },
  { id: "downloader", label: "Downloader", group: "Products" },
  { id: "ai", label: "Frenz AI", group: "Products" },
  /* Everything shared. Deliberately not duplicated inside each product. */
  { id: "platform", label: "Platform", group: "Platform" },
  { id: "monetization", label: "Monetization", group: "Monetization" },
  { id: "insight", label: "Insight", group: "Insight" },
];

export interface AdminSection {
  id: string;
  label: string;
  category: AdminCategoryId;
  /** Lucide icon name, resolved by the UI so this module stays render-free. */
  icon: string;
  /** One line shown under the section heading. */
  blurb: string;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  /* ── Money ── */
  {
    id: "monetization",
    label: "Revenue",
    category: "monetization",
    icon: "DollarSign",
    blurb: "Subscription income at your configured prices, and real ad engagement.",
  },
  {
    id: "ads",
    label: "Ad placements",
    category: "monetization",
    icon: "Megaphone",
    blurb: "Every slot on the site, what fills it, and how each one is performing.",
  },
  {
    id: "affiliates",
    label: "Affiliates & tools",
    category: "monetization",
    icon: "Handshake",
    blurb: "Offers on the result page and the curated tool sections.",
  },
  {
    id: "pricing",
    label: "Pricing & plans",
    category: "monetization",
    icon: "CreditCard",
    blurb: "Displayed prices and per-plan limits. Revenue is calculated from these.",
  },
  {
    id: "commerce",
    label: "Commerce",
    category: "monetization",
    icon: "ShoppingBag",
    blurb: "The Enterprise Commerce Platform described by itself: every service, commerce type, payment capability, plan, billing/promotion feature and AI capability, mapped to real code.",
  },

  /* ── Audience ── */
  {
    id: "activity",
    label: "Live activity",
    category: "platform",
    icon: "Rss",
    blurb: "Every notable event as it happens — downloads, ad clicks, subscriptions, installs — including signed-out visitors.",
  },
  {
    id: "subscribers",
    label: "Subscribers",
    category: "platform",
    icon: "Users",
    blurb: "Who is paying, on which plan, through which provider.",
  },
  {
    id: "streaks",
    label: "Streaks",
    category: "platform",
    icon: "Flame",
    blurb:
      "Daily-streak retention: how many people are on a run, how long, how many are about to lose one, and whether the 2pm reminders are reaching them. Includes anonymous visitors, who have streaks too.",
  },
  {
    id: "moderation",
    label: "Moderation",
    category: "platform",
    icon: "ShieldAlert",
    blurb: "Reported content and accounts, and the appeals queue.",
  },
  {
    id: "support",
    label: "Support inbox",
    category: "platform",
    icon: "Headset",
    blurb: "1:1 support conversations with members. Reply here — members are notified by push and email.",
  },
  {
    id: "ratings",
    label: "App ratings",
    category: "platform",
    icon: "Star",
    blurb:
      "What members and guests said when the app asked them to rate it, newest first. Guests can rate, so this is the only feedback surface that reaches the signed-out majority.",
  },
  {
    id: "verification",
    label: "Verification",
    category: "platform",
    icon: "BadgeCheck",
    blurb:
      "Blue-tick applications: check the legal name against the document and the selfie against the face, then approve or decline. You can also issue a tick directly, with no application.",
  },

  /*
    ── 🔴 FRENZ AI GETS A SECTION OF ITS OWN ─────────────────────────────────

    Owner, 2026-09-09: "Everything related to AI functionality must live inside
    this section… Any future AI tools should automatically belong under Frenz AI
    instead of being added to the general dashboard."

    Until now there was no AI section at all: `FrenzAISettings` and
    `FrenzAIHealth` were rendered by `LandingSection`, beside the hero poster
    and the feed-grid images — because that is where the first AI switch
    happened to be added, not because it belonged there. An operator looking for
    the AI price found it under "Landing page".

    🔴 It is a PRODUCT category, so a future AI tool adds a panel here rather
    than a top-level entry. That is the whole reason the axis changed.
  */
  {
    id: "ai",
    label: "Frenz AI",
    category: "ai",
    icon: "Sparkles",
    blurb:
      "Who may use Frenz AI and what it costs them: the free daily and weekly allowances, the price per video, the billing currency and the smallest top-up, plus job health — how many ran today, how many finished, and whether anybody is sitting on a finished video they were never told about. Every number here applies to the next job anybody starts; nothing needs a deploy.",
  },

  /* ── Content ── */
  {
    id: "trending",
    label: "Trending",
    category: "downloader",
    icon: "Flame",
    blurb: "What the feed promotes, and the broadcast composer.",
  },
  {
    id: "wallpapers",
    label: "Wallpapers",
    category: "wallpaper",
    icon: "Image",
    blurb:
      "Upload and curate the wallpaper library shown on the download page and the full-screen gallery at /wallpapers. Hide a wallpaper to shelve it without losing its likes and comments.",
  },
  {
    id: "platform-status",
    label: "Platform status",
    category: "downloader",
    icon: "Activity",
    blurb:
      "Declare which download platforms are working, partly working or down. Sets the small green / amber / red light on every platform logo across the site — so when TikTok breaks people stop retrying instead of assuming Frenzsave is broken. Nothing detects this automatically: a failed download could be one bad link, a region block or a rate limit, and only a human can tell them apart.",
  },
  {
    id: "landing",
    label: "Landing page",
    category: "insight",
    icon: "Home",
    blurb: "The public front door — the hero reels-mockup poster and the 2×2 feed-grid images every visitor sees. Only these images are admin-driven; the rest is baked in for speed.",
  },
  {
    id: "discovery",
    label: "Search & SEO",
    category: "insight",
    icon: "Telescope",
    blurb: "The Enterprise Search & Discovery Platform described by itself: every searchable entity, index, ranking signal, SEO asset and discovery surface, mapped to real code.",
  },
  {
    id: "media",
    label: "Media",
    category: "insight",
    icon: "Clapperboard",
    blurb: "The Enterprise Media Platform described by itself: every media service, storage tier, pipeline stage, delivery capability, AI capability and observability signal, mapped to real code.",
  },
  {
    id: "notifications",
    label: "Notifications",
    category: "platform",
    icon: "Bell",
    blurb: "The Enterprise Notification Platform described by itself: every service, channel, source, delivery capability, preference and AI capability, mapped to real code.",
  },

  /* ── System ── */
  {
    id: "globalization",
    label: "Globalization",
    category: "platform",
    icon: "Languages",
    blurb: "The Enterprise Globalization Platform described by itself: every locale, localization service, regional format, currency and timezone capability, localized surface and AI capability, mapped to real code. Locale coverage is measured, never declared.",
  },
  {
    id: "workspaces",
    label: "Workspaces",
    category: "platform",
    icon: "LayoutGrid",
    blurb: "The Enterprise Workspace Framework described by itself: every registered workspace, framework service, Platform Shell capability, navigation capability, lifecycle/shared-platform capability and extensibility/AI capability, mapped to real code. A modular monolith — micro-frontends and plugins are honestly planned.",
  },
  {
    id: "flags",
    label: "Feature flags",
    category: "platform",
    icon: "Flag",
    blurb: "Runtime toggles and rollouts. Flags are declared in code; their state is set here.",
  },
  {
    id: "experiments",
    label: "Experiments",
    category: "platform",
    icon: "FlaskConical",
    blurb: "A/B tests and their live exposure split. Declared in code; paused and shipped from here.",
  },
  {
    id: "platform",
    label: "Platform",
    category: "platform",
    icon: "Boxes",
    blurb: "The Experience OS described by itself: every registry, service and event, mapped to real code.",
  },
  {
    id: "communication",
    label: "Communication",
    category: "platform",
    icon: "Radio",
    blurb: "The comms backbone: domain event contracts and every integration surface (APIs, realtime, webhooks, workflows).",
  },
  {
    id: "data",
    label: "Data",
    category: "insight",
    icon: "Database",
    blurb: "The Enterprise Data Platform: every domain and table, storage strategies, lifecycle policies and the Knowledge Fabric.",
  },
  {
    id: "quality",
    label: "Quality",
    category: "insight",
    icon: "BadgeCheck",
    blurb: "Production-readiness: certifications computed from the governance gates, and the test-type coverage.",
  },
  {
    id: "config",
    label: "Configuration",
    category: "platform",
    icon: "SlidersHorizontal",
    blurb: "Everything runtime-configurable without a redeploy — and an audited history of every change.",
  },
  {
    id: "design",
    label: "Design system",
    category: "platform",
    icon: "Palette",
    blurb: "The Experience OS described by itself: design tokens, every reusable component with its a11y + motion contract, the motion language and themes.",
  },
  {
    id: "engineering",
    label: "Engineering",
    category: "insight",
    icon: "Wrench",
    blurb: "The Developer Experience Platform: every doc, generator, SDK and registry, plus the engineering standards and how each is enforced.",
  },
  {
    id: "traffic",
    label: "Traffic",
    category: "downloader",
    icon: "Activity",
    blurb: "Downloads by platform and kind, and recent alerts.",
  },
  {
    id: "health",
    label: "Health",
    category: "platform",
    icon: "HeartPulse",
    blurb: "Proxy spend, messaging throughput and push delivery.",
  },
];

/** The section shown when the dashboard opens. */
export const DEFAULT_ADMIN_SECTION = "monetization";

export function sectionsInCategory(category: AdminCategoryId): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => s.category === category);
}

export function getAdminSection(id: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((s) => s.id === id);
}
