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

export type AdminCategoryId = "money" | "audience" | "content" | "system";

export interface AdminCategory {
  id: AdminCategoryId;
  label: string;
}

export const ADMIN_CATEGORIES: AdminCategory[] = [
  { id: "money", label: "Money" },
  { id: "audience", label: "Audience" },
  { id: "content", label: "Content" },
  { id: "system", label: "System" },
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
    category: "money",
    icon: "DollarSign",
    blurb: "Subscription income at your configured prices, and real ad engagement.",
  },
  {
    id: "ads",
    label: "Ad placements",
    category: "money",
    icon: "Megaphone",
    blurb: "Every slot on the site, what fills it, and how each one is performing.",
  },
  {
    id: "affiliates",
    label: "Affiliates & tools",
    category: "money",
    icon: "Handshake",
    blurb: "Offers on the result page and the curated tool sections.",
  },
  {
    id: "pricing",
    label: "Pricing & plans",
    category: "money",
    icon: "CreditCard",
    blurb: "Displayed prices and per-plan limits. Revenue is calculated from these.",
  },

  /* ── Audience ── */
  {
    id: "activity",
    label: "Live activity",
    category: "audience",
    icon: "Rss",
    blurb: "Every notable event as it happens — downloads, ad clicks, subscriptions, installs — including signed-out visitors.",
  },
  {
    id: "subscribers",
    label: "Subscribers",
    category: "audience",
    icon: "Users",
    blurb: "Who is paying, on which plan, through which provider.",
  },
  {
    id: "moderation",
    label: "Moderation",
    category: "audience",
    icon: "ShieldAlert",
    blurb: "Reported content and accounts, and the appeals queue.",
  },

  /* ── Content ── */
  {
    id: "trending",
    label: "Trending",
    category: "content",
    icon: "Flame",
    blurb: "What the feed promotes, and the broadcast composer.",
  },

  /* ── System ── */
  {
    id: "flags",
    label: "Feature flags",
    category: "system",
    icon: "Flag",
    blurb: "Runtime toggles and rollouts. Flags are declared in code; their state is set here.",
  },
  {
    id: "experiments",
    label: "Experiments",
    category: "system",
    icon: "FlaskConical",
    blurb: "A/B tests and their live exposure split. Declared in code; paused and shipped from here.",
  },
  {
    id: "platform",
    label: "Platform",
    category: "system",
    icon: "Boxes",
    blurb: "The Experience OS described by itself: every registry, service and event, mapped to real code.",
  },
  {
    id: "communication",
    label: "Communication",
    category: "system",
    icon: "Radio",
    blurb: "The comms backbone: domain event contracts and every integration surface (APIs, realtime, webhooks, workflows).",
  },
  {
    id: "data",
    label: "Data",
    category: "system",
    icon: "Database",
    blurb: "The Enterprise Data Platform: every domain and table, storage strategies, lifecycle policies and the Knowledge Fabric.",
  },
  {
    id: "quality",
    label: "Quality",
    category: "system",
    icon: "BadgeCheck",
    blurb: "Production-readiness: certifications computed from the governance gates, and the test-type coverage.",
  },
  {
    id: "config",
    label: "Configuration",
    category: "system",
    icon: "SlidersHorizontal",
    blurb: "Everything runtime-configurable without a redeploy — and an audited history of every change.",
  },
  {
    id: "design",
    label: "Design system",
    category: "system",
    icon: "Palette",
    blurb: "The Experience OS described by itself: design tokens, every reusable component with its a11y + motion contract, the motion language and themes.",
  },
  {
    id: "engineering",
    label: "Engineering",
    category: "system",
    icon: "Wrench",
    blurb: "The Developer Experience Platform: every doc, generator, SDK and registry, plus the engineering standards and how each is enforced.",
  },
  {
    id: "traffic",
    label: "Traffic",
    category: "system",
    icon: "Activity",
    blurb: "Downloads by platform and kind, and recent alerts.",
  },
  {
    id: "health",
    label: "Health",
    category: "system",
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
