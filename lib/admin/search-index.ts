import { ADMIN_SECTIONS } from "./sections";

/**
 * What admin search can find — the PURE half.
 *
 * 🔴 No React, no Supabase, no I/O. The search box is a client component and
 * the guard test imports this directly.
 *
 * ── Why sections alone were not enough ───────────────────────────────────
 * Owner, 2026-09-02, hunting for the VAST start-ad toggle: "how do i turn of
 * enableon download ? i cant find it".
 *
 * It was there the whole time — Monetization → VAST interstitial → "Show when a
 * download STARTS". The reason it could not be found is that operators search
 * for the thing they want to change, and the dashboard only had 32 SECTION
 * names to match against. Nobody guesses which of "Revenue", "Ad placements" or
 * "Config" owns a particular switch.
 *
 * So this indexes CONTROLS, not just screens. Each entry carries the words a
 * person would actually type — including the internal setting key, because
 * somebody reading a commit message or a support reply will paste that.
 *
 * ── The honesty rule for this file ──────────────────────────────────────
 * Every entry must point at a control that REALLY EXISTS, in the section named.
 * A search result that leads nowhere is worse than no result: it costs the
 * operator the hunt AND their trust in the box. `search-index.test.ts` asserts
 * every `section` resolves to a real admin section; it cannot assert the
 * control exists, so that part is on whoever adds an entry.
 */

export interface AdminSearchEntry {
  /** Stable id, used as a React key. */
  id: string;
  /** What the operator sees in the results list. */
  label: string;
  /** The admin section id this lives in — must exist in ADMIN_SECTIONS. */
  section: string;
  /** Where inside the section, in the words the UI actually uses. */
  hint: string;
  /**
   * Extra search terms: synonyms, the internal setting key, and the phrasing
   * somebody would use if they did not know our label.
   */
  keywords: string[];
}

/**
 * Individual controls worth finding directly.
 *
 * Deliberately NOT exhaustive — an index that tries to list every field goes
 * stale silently, and a wrong pointer is worse than a missing one. These are the
 * ones operators actually hunt for: the ad switches, the money settings and the
 * things that change what visitors see.
 */
export const ADMIN_SETTING_ENTRIES: AdminSearchEntry[] = [
  /* ── The VAST interstitial: the exact controls that prompted this ── */
  {
    id: "vast.enabledOnDownload",
    label: "Show an ad when a download STARTS",
    section: "monetization",
    hint: "Monetization → VAST interstitial → “Show when a download STARTS”",
    keywords: ["enabledOnDownload", "vast", "download start", "start ad", "interstitial", "hilltop", "video ad", "turn off ad"],
  },
  {
    id: "vast.enabledOnDownloadComplete",
    label: "Show an ad when a download COMPLETES",
    section: "monetization",
    hint: "Monetization → VAST interstitial → “Show when a download COMPLETES”",
    keywords: ["enabledOnDownloadComplete", "vast", "download complete", "completion ad", "interstitial", "hilltop"],
  },
  {
    id: "vast.enabled",
    label: "VAST interstitial master switch",
    section: "monetization",
    hint: "Monetization → VAST interstitial",
    keywords: ["vast", "video ad", "interstitial", "master switch", "hilltop vast", "disable ads"],
  },
  {
    id: "vast.skipAfterSeconds",
    label: "Seconds before an ad can be skipped",
    section: "monetization",
    hint: "Monetization → VAST interstitial → “Allow skip / close”",
    keywords: ["skipAfterSeconds", "skip", "countdown", "how long", "seconds", "close ad"],
  },
  {
    id: "vast.cooldownMs",
    label: "Minimum gap between two interstitials",
    section: "monetization",
    hint: "Monetization → VAST interstitial → cooldown",
    keywords: ["cooldownMs", "cooldown", "frequency", "too many ads", "gap", "how often"],
  },

  /* ── Networks ── */
  {
    id: "hilltop",
    label: "HilltopAds — banners, video slider and VAST zones",
    section: "monetization",
    hint: "Monetization → HilltopAds",
    keywords: ["hilltop", "hilltopads", "banner", "video slider", "vast", "zone", "massivesalad"],
  },
  {
    id: "adsense",
    label: "Google AdSense publisher ID",
    section: "monetization",
    hint: "Monetization → AdSense",
    keywords: ["adsense", "google", "ca-pub", "publisher id", "auto ads", "approval"],
  },
  {
    id: "monetag",
    label: "Monetag",
    section: "monetization",
    hint: "Monetization → Monetag",
    keywords: ["monetag", "network", "push", "popunder"],
  },
  {
    id: "popunder",
    label: "Pop-under / OnClick units",
    section: "monetization",
    hint: "Monetization → pop-under switch",
    keywords: ["popunder", "pop under", "onclick", "click hijack", "popup"],
  },
  {
    id: "reward-networks",
    label: "Which ad network pays for each reward moment",
    section: "monetization",
    hint: "Monetization → Reward networks",
    keywords: ["reward", "offerium", "gpt", "rewarded", "batch", "hd download", "wallpaper", "gate"],
  },
  {
    id: "cpm",
    label: "Estimated CPM used for the revenue projection",
    section: "monetization",
    hint: "Revenue → CPM estimate",
    keywords: ["cpm", "revenue", "estimate", "projection", "rate", "earnings"],
  },

  /* ── Placements ── */
  {
    id: "ad-zones",
    label: "Ad placements — every slot and what fills it",
    section: "ads",
    hint: "Ad placements",
    keywords: ["zone", "slot", "placement", "banner", "creative", "ad row", "where ads show"],
  },

  /* ── Money ── */
  {
    id: "pricing",
    label: "Plan prices and currencies",
    section: "pricing",
    hint: "Pricing & plans",
    keywords: ["price", "pricing", "plan", "pro", "business", "currency", "paystack", "subscription"],
  },
  {
    id: "plan-limits",
    label: "What each plan may do — batch size, quality, quotas",
    section: "pricing",
    hint: "Pricing & plans → limits",
    keywords: ["limit", "quota", "batch", "cap", "free plan", "20", "restriction"],
  },

  /* ── Content and visitors ── */
  {
    id: "landing",
    label: "Landing page content",
    section: "landing",
    hint: "Landing editor",
    keywords: ["landing", "homepage", "hero", "headline", "front page"],
  },
  {
    id: "announcement",
    label: "Site-wide announcement bar",
    section: "notifications",
    hint: "Notifications → announcement",
    keywords: ["announcement", "banner", "notice", "top bar", "message"],
  },
  {
    id: "platform-status",
    label: "Turn a platform on or off",
    section: "platform-status",
    hint: "Platform status",
    keywords: ["platform", "tiktok", "instagram", "disable", "maintenance", "broken", "off"],
  },
  {
    id: "trending",
    label: "Trending and momentum weights",
    section: "trending",
    hint: "Trending",
    keywords: ["trending", "momentum", "ranking", "hot score", "feed order", "recompute"],
  },
  {
    id: "flags",
    label: "Feature flags",
    section: "flags",
    hint: "Feature flags",
    keywords: ["flag", "feature", "toggle", "rollout", "enable", "disable"],
  },
  {
    id: "moderation",
    label: "Reported content queue",
    section: "moderation",
    hint: "Moderation",
    keywords: ["report", "moderation", "abuse", "takedown", "flagged", "review"],
  },
  {
    id: "verification",
    label: "Verification requests",
    section: "verification",
    hint: "Verification",
    keywords: ["verify", "verified", "badge", "tick", "request", "approve"],
  },
  {
    id: "subscribers",
    label: "Members and their plans",
    section: "subscribers",
    hint: "Subscribers",
    keywords: ["user", "member", "subscriber", "account", "plan", "upgrade", "admin"],
  },
];

export interface AdminSearchResult extends AdminSearchEntry {
  /** Lower is better. Exposed so the UI can show sections and settings apart. */
  score: number;
  kind: "section" | "setting";
}

/** Sections, expressed in the same shape so one index covers both. */
function sectionEntries(): AdminSearchEntry[] {
  return ADMIN_SECTIONS.map((s) => ({
    id: `section:${s.id}`,
    label: s.label,
    section: s.id,
    hint: s.blurb,
    keywords: [s.id, s.category],
  }));
}

function norm(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Rank entries against a query.
 *
 * Scoring is intentionally simple and explainable — an exact label match beats a
 * label prefix, which beats a keyword hit, which beats a hint hit. Anything
 * cleverer becomes impossible to predict, and an operator who cannot predict
 * their own search box stops using it.
 *
 * Settings outrank sections at equal score, because somebody typing a specific
 * phrase wants the control, not the screen that contains it.
 */
export function searchAdmin(query: string, limit = 8): AdminSearchResult[] {
  const q = norm(query);
  if (q.length < 2) return [];

  const all: { entry: AdminSearchEntry; kind: "section" | "setting" }[] = [
    ...ADMIN_SETTING_ENTRIES.map((entry) => ({ entry, kind: "setting" as const })),
    ...sectionEntries().map((entry) => ({ entry, kind: "section" as const })),
  ];

  const scored: AdminSearchResult[] = [];
  for (const { entry, kind } of all) {
    const label = norm(entry.label);
    const hint = norm(entry.hint);
    const keys = entry.keywords.map(norm);

    let score: number | null = null;
    if (label === q) score = 0;
    else if (label.startsWith(q)) score = 1;
    else if (keys.some((k) => k === q)) score = 2;
    else if (label.includes(q)) score = 3;
    else if (keys.some((k) => k.includes(q))) score = 4;
    else if (hint.includes(q)) score = 5;

    if (score !== null) scored.push({ ...entry, score: score + (kind === "section" ? 0.5 : 0), kind });
  }

  return scored.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)).slice(0, limit);
}
