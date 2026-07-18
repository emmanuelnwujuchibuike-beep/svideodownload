/**
 * The Product Genome registry — one record per module in `lib/platform/modules.ts`.
 *
 * POPULATION RULE (this is the whole point of the file): every field is either a
 * verified fact or absent. An unbuilt product gets a sparse genome, never an
 * imagined one. `studio` and `cloud` below are nearly empty because nearly nothing
 * about them is true yet, and that emptiness is itself the useful signal — it is
 * what stops a content generator, a feature card, or an AI summary from inventing
 * detail. Sparse is information. Fabricated is a liability.
 *
 * Facts here were verified against the running codebase on 2026-07-18, not recalled.
 */
import type { ProductGenome } from "./types";

/* ------------------------------- Download (live) ------------------------------ */

const download: ProductGenome = {
  id: "download",
  purpose:
    "Save video, audio and images from public social links without installing an app or handing over an account.",

  capabilities: [
    {
      id: "extract",
      name: "Link extraction",
      description: "Resolves a public post URL to its underlying media renditions.",
      stage: "live",
      provingRoute: "/api/download",
    },
    {
      id: "quality-select",
      name: "Quality selection",
      description: "Choose the rendition before saving, up to the best the source provides.",
      stage: "live",
      provingRoute: "/downloads",
    },
    {
      id: "audio-extract",
      name: "Audio extraction",
      description: "Save the soundtrack alone as an MP3.",
      stage: "live",
      provingRoute: "/downloads",
    },
    {
      id: "watermark-free",
      name: "Watermark-free saves",
      description:
        "Sources flagged `watermarkFree` in the platform registry return a clean file. This is per-platform, not universal — see `lib/platforms.ts`.",
      stage: "live",
    },
    {
      id: "batch",
      name: "Batch downloads",
      description: "Queue several links in one pass.",
      stage: "beta",
      provingRoute: "/downloads",
    },
  ],

  features: {
    core: [
      { id: "paste-link", name: "Paste a link", stage: "live", essential: true },
      { id: "pick-format", name: "Pick format and quality", stage: "live", essential: true },
      { id: "save-file", name: "Save to device", stage: "live", essential: true },
    ],
    optional: [
      { id: "history", name: "Download history", stage: "live", essential: false },
      { id: "publish", name: "Publish a save to a profile", stage: "live", essential: false },
      { id: "share-target", name: "OS share-target hand-off", stage: "live", essential: false },
    ],
  },

  dependencies: [],
  integrations: [
    { name: "Cloudflare R2", kind: "storage", active: true, notes: "Media object storage." },
    { name: "Cloudflare Stream", kind: "media", active: true, notes: "Adaptive playback." },
    { name: "Paystack", kind: "payments", active: true, notes: "Pro/Business upgrades." },
  ],

  surfaces: [
    { kind: "web", stage: "live" },
    { kind: "pwa", stage: "live", notes: "Installable; `/` is precached." },
    { kind: "api", stage: "live", notes: "Business plan; see /developers." },
    { kind: "extension", stage: "concept", notes: "`extension/` exists but ships to no store." },
    { kind: "android", stage: "concept" },
    { kind: "ios", stage: "concept" },
  ],

  permissions: [
    { id: "browser.storage", reason: "Hold the file while it downloads.", required: true },
    { id: "browser.share-target", reason: "Accept links shared from other apps.", required: false },
  ],

  learning: {
    tutorials: [{ id: "how-to-download", title: "How to save a video", stage: "planned" }],
    academy: [],
    faqs: [{ id: "downloader-faq", title: "Downloader FAQ", href: "/#faq", stage: "live" }],
  },
  developer: {
    apiRefs: [{ id: "download-api", title: "Download API", href: "/developers", stage: "live" }],
    guides: [],
  },

  releases: [
    {
      version: "1.1.0",
      date: "2026-07-17",
      changes: ["Poster URLs re-hosted at ingest so thumbnails stop expiring."],
      breaking: false,
      evidence: "ec26967",
    },
  ],
  compatibility: [
    { subject: "iOS Safari", min: "16", notes: "Share-target hand-off needs an installed PWA." },
  ],

  accessibility: {
    wcagLevel: "AA",
    notes: ["Keyboard-operable form.", "No formal audit recorded — do not claim one."],
  },
  privacy: {
    dataCollected: ["Submitted URL", "Chosen format", "Anonymous download counts"],
    retention: "Download rows persist to the signed-in user's history; anonymous saves are not linked to a person.",
    policyAnchor: "/privacy",
  },
  security: {
    authRequired: false,
    rlsPolicies: ["downloads: owner-scoped select/insert"],
    threatNotes: [
      "Public endpoint — rate-limited (`lib/rate-limit.ts`).",
      "No media is re-hosted from the source; extraction is transient (docs/CONTENT_LAYER_RFC.md §3).",
    ],
  },
  performance: {
    budgetMs: 2000,
    lcpTargetMs: 2000,
    measured: { measuredAt: "2026-07-17", lcpMs: 2004, notes: "Landing `/`, slow-4G + 4x CPU." },
  },

  analytics: [
    { id: "download_started", name: "Download started", description: "A save was requested.", collected: true },
    { id: "download_completed", name: "Download completed", description: "Bytes delivered.", collected: true },
    { id: "format_chosen", name: "Format chosen", description: "Which rendition users pick.", collected: false },
  ],
  seo: {
    title: "Free Video Downloader — Save Video & Audio",
    description:
      "Save video, audio and images from public social links. No app, no account, free.",
    keywords: ["video downloader", "mp4 downloader", "mp3 converter", "save reels"],
    canonical: "/",
  },
  structuredData: [
    {
      type: "SoftwareApplication",
      data: {
        applicationCategory: "MultimediaApplication",
        operatingSystem: "Web",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    },
  ],

  related: ["community"],
  workflows: [
    { id: "save-then-share", title: "Save a clip, then post it", steps: ["download", "community"] },
  ],
  roadmap: [{ id: "browser-extension", title: "Browser extension", horizon: "exploring" }],
};

/* ------------------------------ Community (live) ------------------------------ */

const community: ProductGenome = {
  id: "community",
  purpose:
    "A social layer where people post, watch reels and stories, message each other, and follow creators.",

  capabilities: [
    { id: "feed", name: "Ranked home feed", description: "For You / Trending ranking.", stage: "live", provingRoute: "/home" },
    { id: "reels", name: "Reels", description: "Full-screen vertical video.", stage: "live", provingRoute: "/reels" },
    { id: "stories", name: "Stories", description: "24-hour ephemeral posts.", stage: "live", provingRoute: "/home" },
    { id: "messaging", name: "Direct messaging", description: "Realtime 1:1 and group chat.", stage: "live", provingRoute: "/messages" },
    { id: "reshare", name: "Resharing", description: "Chat→feed/reel/story and story→story/chat, gated by author permission.", stage: "live" },
    { id: "explore", name: "Explore", description: "Discovery surface.", stage: "live", provingRoute: "/explore" },
  ],

  features: {
    core: [
      { id: "post", name: "Create a post", stage: "live", essential: true },
      { id: "follow", name: "Follow people", stage: "live", essential: true },
      { id: "comment", name: "Comment", stage: "live", essential: true },
    ],
    optional: [
      { id: "polls", name: "Polls", stage: "live", essential: false },
      { id: "collections", name: "Saved collections", stage: "live", essential: false },
      { id: "guest-like", name: "Anonymous guest likes", stage: "live", essential: false },
    ],
  },

  dependencies: ["download"],
  integrations: [
    { name: "Supabase Realtime", kind: "other", active: true, notes: "Presence, typing, delivery." },
    { name: "Web Push (VAPID)", kind: "push", active: true },
    { name: "Resend", kind: "email", active: true },
  ],

  surfaces: [
    { kind: "web", stage: "live" },
    { kind: "pwa", stage: "live" },
    { kind: "android", stage: "concept" },
    { kind: "ios", stage: "concept" },
  ],

  permissions: [
    { id: "browser.notifications", reason: "Deliver message and activity push.", required: false },
    { id: "browser.camera", reason: "Capture media in the composer.", required: false },
    { id: "browser.microphone", reason: "Record voice notes.", required: false },
  ],

  learning: {
    tutorials: [{ id: "first-post", title: "Publish your first post", stage: "planned" }],
    academy: [],
    faqs: [],
  },
  developer: { apiRefs: [], guides: [] },

  releases: [
    {
      version: "2.4.0",
      date: "2026-07-18",
      changes: ["Inbox chrome moved to the persistent shell; swipe-back no longer flashes."],
      breaking: false,
      evidence: "28053f3",
    },
    {
      version: "2.3.0",
      date: "2026-07-16",
      changes: ["Reshare system.", "Hidden accounts became friends-only."],
      breaking: false,
      evidence: "migrations 0081, 0082",
    },
  ],
  compatibility: [{ subject: "migration", min: "0084", notes: "0083 has a 42703 fallback." }],

  accessibility: {
    wcagLevel: "AA",
    notes: [
      "Reduced-motion honoured by the page-transition system.",
      "Safe-area insets applied to fixed top elements in the reels immersion layer.",
    ],
  },
  privacy: {
    dataCollected: ["Posts", "Messages", "Follows", "Engagement events", "Presence"],
    retention: "User-controlled: posts and messages are deletable; account deletion is supported.",
    policyAnchor: "/privacy",
  },
  security: {
    authRequired: true,
    rlsPolicies: [
      "posts: publish gates check is_suspended only",
      "conversations: participant-scoped",
      "user_restrictions: blocking and muting",
    ],
    threatNotes: [
      "A self-referential RLS policy once broke all reads silently — smoke-test RLS as a real client.",
      "Hidden (`is_hidden`) and suspended (`is_suspended`) are separate concerns; never re-merge.",
    ],
  },
  performance: {
    budgetMs: 2000,
    lcpTargetMs: 2000,
    measured: { measuredAt: "2026-07-17", blockingMs: 835, notes: "Hydration cost, throttled profile." },
  },

  analytics: [
    { id: "post_created", name: "Post created", description: "A post was published.", collected: true },
    { id: "feed_impression", name: "Feed impression", description: "An item entered the viewport.", collected: true },
    { id: "journey_completion", name: "Journey completion", description: "Signup → first post.", collected: false },
  ],
  seo: {
    title: "Frenzsave Community — Share What You Save",
    description: "Post, watch reels and stories, message friends, and follow creators.",
    keywords: ["social video", "reels", "stories"],
    canonical: "/",
  },
  structuredData: [
    { type: "WebApplication", data: { applicationCategory: "SocialNetworkingApplication" } },
  ],

  related: ["download"],
  workflows: [
    { id: "save-then-share", title: "Save a clip, then post it", steps: ["download", "community"] },
  ],
  roadmap: [{ id: "moments", title: "Moments stream", horizon: "later" }],
};

/* ------------------------------ Studio (concept) ------------------------------ */

/**
 * Sparse ON PURPOSE. There is no `/studio` route and no editing code. Every field
 * below is either empty or explicitly `concept`. Do not enrich this from the
 * marketing mockup — the mockup describes a product that does not exist, and
 * copying it here would launder an aspiration into the source of truth.
 */
const studio: ProductGenome = {
  id: "studio",
  // Status lives in `veracity.stage`, never in this sentence. A "Planned:" prefix
  // would be status encoded as prose — unqueryable, and it leaks into any surface
  // that renders `purpose`. The field describes what the product IS; the stage
  // says whether it exists yet.
  purpose: "Trim, edit and remix the media you capture.",
  capabilities: [],
  features: { core: [], optional: [] },
  dependencies: ["download"],
  integrations: [],
  surfaces: [{ kind: "web", stage: "concept" }],
  permissions: [],
  learning: { tutorials: [], academy: [], faqs: [] },
  developer: { apiRefs: [], guides: [] },
  releases: [],
  compatibility: [],
  accessibility: { wcagLevel: "AA", notes: ["Not built; nothing audited."] },
  privacy: { dataCollected: [], retention: "n/a — not built.", policyAnchor: "/privacy" },
  security: { authRequired: true, rlsPolicies: [], threatNotes: [] },
  performance: { budgetMs: 2000, lcpTargetMs: 2000 },
  analytics: [],
  seo: { title: "Frenzsave Studio", description: "Planned editing tools.", keywords: [], canonical: "/" },
  structuredData: [],
  related: ["download"],
  workflows: [],
  roadmap: [{ id: "studio-mvp", title: "Trim and export", horizon: "exploring" }],
};

/* ------------------------------- Cloud (concept) ------------------------------ */

/** Sparse on purpose — see the note on `studio`. No `/cloud` route exists. */
const cloud: ProductGenome = {
  id: "cloud",
  purpose: "Keep your saved library synced across every device.",
  capabilities: [],
  features: { core: [], optional: [] },
  dependencies: ["download"],
  integrations: [],
  surfaces: [{ kind: "web", stage: "concept" }],
  permissions: [],
  learning: { tutorials: [], academy: [], faqs: [] },
  developer: { apiRefs: [], guides: [] },
  releases: [],
  compatibility: [],
  accessibility: { wcagLevel: "AA", notes: ["Not built; nothing audited."] },
  privacy: { dataCollected: [], retention: "n/a — not built.", policyAnchor: "/privacy" },
  security: { authRequired: true, rlsPolicies: [], threatNotes: [] },
  performance: { budgetMs: 2000, lcpTargetMs: 2000 },
  analytics: [],
  seo: { title: "Frenzsave Cloud", description: "Planned synced library.", keywords: [], canonical: "/" },
  structuredData: [],
  related: ["download"],
  workflows: [],
  roadmap: [{ id: "cloud-sync", title: "Cross-device library", horizon: "exploring" }],
};

/* ------------------------------ Smart (internal) ------------------------------ */

/**
 * Backend-only. `app/api/assistant/route.ts` exists; the widget is commented out of
 * `app/layout.tsx`. Nothing is user-reachable, so nothing may be claimed.
 *
 * Brand rule: this suite is "Smart", never "AI", in product naming
 * (see the comment on the module entry in `lib/platform/modules.ts`).
 */
const smart: ProductGenome = {
  id: "smart",
  purpose: "Summaries, captions and smarter search across everything you save.",
  capabilities: [
    {
      id: "assistant",
      name: "Assistant endpoint",
      description: "Server route exists; no mounted UI surface.",
      stage: "internal",
      provingRoute: "/api/assistant",
    },
  ],
  features: { core: [], optional: [] },
  dependencies: ["community"],
  integrations: [],
  surfaces: [{ kind: "api", stage: "internal", notes: "No UI surface mounted." }],
  permissions: [],
  learning: { tutorials: [], academy: [], faqs: [] },
  developer: { apiRefs: [], guides: [] },
  releases: [],
  compatibility: [],
  accessibility: { wcagLevel: "AA", notes: ["No UI to audit."] },
  privacy: {
    dataCollected: ["Prompt text when the endpoint is called"],
    retention: "Not retained beyond the request.",
    policyAnchor: "/privacy",
  },
  security: { authRequired: true, rlsPolicies: [], threatNotes: ["Endpoint is live while its UI is not — keep it authenticated."] },
  performance: { budgetMs: 2000, lcpTargetMs: 2000 },
  analytics: [],
  seo: { title: "Frenzsave Smart", description: "Planned smart tools.", keywords: [], canonical: "/" },
  structuredData: [],
  related: ["community"],
  workflows: [],
  roadmap: [{ id: "remount-widget", title: "Re-mount the assistant widget", horizon: "next" }],
};

/* ------------------------------- Admin (internal) ----------------------------- */

const admin: ProductGenome = {
  id: "admin",
  purpose: "Operate the platform — moderation, stats, ads and recommended tools.",
  capabilities: [
    { id: "stats", name: "Platform stats", description: "Download and usage aggregates.", stage: "live", provingRoute: "/admin" },
    { id: "moderation", name: "Moderation", description: "Reports, appeals, restrictions.", stage: "live", provingRoute: "/admin" },
  ],
  features: { core: [{ id: "dashboard", name: "Admin dashboard", stage: "live", essential: true }], optional: [] },
  dependencies: ["community", "download"],
  integrations: [{ name: "Resend", kind: "email", active: true, notes: "Admin alerts." }],
  surfaces: [{ kind: "web", stage: "live" }],
  permissions: [{ id: "role.admin", reason: "Operate the platform.", required: true }],
  learning: { tutorials: [], academy: [], faqs: [] },
  developer: { apiRefs: [], guides: [] },
  releases: [],
  compatibility: [],
  accessibility: { wcagLevel: "AA", notes: ["Internal tool; not audited."] },
  privacy: {
    dataCollected: ["Moderation actions", "Admin audit events"],
    retention: "Audit rows are append-only.",
    policyAnchor: "/privacy",
  },
  security: {
    authRequired: true,
    rlsPolicies: ["admin reads gated by ADMIN_EMAILS"],
    threatNotes: ["Cross-account push leak was found here once — verify recipient scoping."],
  },
  performance: { budgetMs: 4000, lcpTargetMs: 4000, measured: undefined },
  analytics: [],
  seo: { title: "Frenzsave Admin", description: "Internal.", keywords: [], canonical: "/" },
  structuredData: [],
  related: [],
  workflows: [],
  roadmap: [{ id: "content-admin", title: "Living Content Platform admin (RFC Phase 4)", horizon: "later" }],
};

/* --------------------------------- the registry ------------------------------- */

export const GENOMES: Record<string, ProductGenome> = {
  download,
  community,
  studio,
  cloud,
  smart,
  admin,
};
