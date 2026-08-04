/**
 * Profile Intelligence™ — the Profile Health Score and the Digital Coach
 * (Feature 18 · Part 15).
 *
 * ── What this is, stated plainly ──────────────────────────────────────────
 * A deterministic advisor, not a language model. Every number below is
 * computed from signals this platform already holds, with a formula written
 * out in full. That is a deliberate choice, not a shortcut:
 *
 *   · A member acting on advice about their PRIVACY and SECURITY deserves to
 *     know exactly why they were told to. "Your security is 40/100 because
 *     two-factor is off and you have no passkey" is auditable. "The AI
 *     suggests…" is not.
 *   · It costs nothing per profile, runs on the server in microseconds, needs
 *     no inference budget, and cannot hallucinate a recommendation that points
 *     at a setting which doesn't exist.
 *   · Nothing here is sent anywhere. The score is computed from the member's
 *     own row, in process, and never leaves it.
 *
 * Where a model would genuinely add something — free-text bio critique,
 * portfolio ordering, image accessibility descriptions — that is called out in
 * `PLANNED_INTELLIGENCE` rather than faked.
 *
 * ── Why the pillars are weighted the way they are ─────────────────────────
 * The score answers "how well does this profile serve the person who owns it?"
 * So Security and Privacy carry real weight even though they are invisible to
 * visitors: a beautiful profile on an unprotected account is not a healthy one.
 * Reach (followers, engagement) is deliberately NOT a pillar — that would make
 * the score a popularity measure a member cannot fix by acting, which is the
 * opposite of what an advisor is for. Every pillar here is something the member
 * can change today.
 *
 * Pure: no React, no Supabase, no I/O, no clock beyond what is passed in.
 */

export type PillarKey = "identity" | "security" | "privacy" | "content" | "community" | "standing";

export interface HealthSignals {
  /* Identity */
  hasHandle: boolean;
  hasDisplayName: boolean;
  hasAvatar: boolean;
  hasBio: boolean;
  hasBanner: boolean;
  hasLinks: boolean;
  /** Part 14: a declared purpose and a filled-in About. */
  profileTypeDeclared: boolean;
  hasHeadline: boolean;

  /* Security */
  emailConfirmed: boolean;
  mfaEnabled: boolean;
  passkeyCount: number;
  hasRecoveryCodes: boolean;
  hasPin: boolean;

  /* Privacy */
  privacyReviewed: boolean;
  /** True when the member has NOT left every activity tab wide open. */
  activityScoped: boolean;
  blockedOrMutedAnyone: boolean;

  /* Content */
  posts: number;
  collections: number;
  /** Part 14 sections that actually hold something. */
  filledModules: number;

  /* Community */
  friends: number;
  following: number;

  /* Standing */
  verified: boolean;
  trustIndex: number; // 0–100, from lib/social/reputation
  accountAgeDays: number;
  suspended: boolean;
}

export interface Pillar {
  key: PillarKey;
  label: string;
  /** 0–100 for this pillar alone. */
  score: number;
  weight: number;
  /** One line describing what this pillar measures. */
  blurb: string;
}

export type Band = "critical" | "needs-work" | "good" | "strong" | "excellent";

export interface Recommendation {
  id: string;
  pillar: PillarKey;
  title: string;
  /** Why it matters — always a reason, never just an instruction. */
  detail: string;
  /** A REAL destination. Every recommendation must be actionable in one tap. */
  href: string;
  /** Higher = surfaced sooner. Security and privacy outrank decoration. */
  priority: number;
}

export interface ProfileHealth {
  score: number;
  band: Band;
  pillars: Pillar[];
  recommendations: Recommendation[];
  /** What is already in good shape — an advisor that only nags is ignored. */
  strengths: string[];
}

const PILLAR_META: Record<PillarKey, { label: string; weight: number; blurb: string }> = {
  identity: { label: "Identity", weight: 25, blurb: "How complete and recognisable your profile is." },
  security: { label: "Security", weight: 25, blurb: "How well your account is protected." },
  privacy: { label: "Privacy", weight: 15, blurb: "Whether you've decided who sees what." },
  content: { label: "Content", weight: 15, blurb: "Whether your profile has something on it." },
  community: { label: "Community", weight: 10, blurb: "Your connections on the platform." },
  standing: { label: "Standing", weight: 10, blurb: "Account age, trust and verification." },
};

/** Clamp to a 0–100 integer. */
function pct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Points for hitting a target, with partial credit and no runaway above it. */
function ratio(value: number, target: number): number {
  if (target <= 0) return 100;
  return Math.min(1, value / target) * 100;
}

function identityScore(s: HealthSignals): number {
  // Weighted so the things a visitor notices first are worth the most.
  const parts: [boolean, number][] = [
    [s.hasHandle, 20],
    [s.hasDisplayName, 15],
    [s.hasAvatar, 20],
    [s.hasBio, 15],
    [s.hasBanner, 10],
    [s.hasLinks, 5],
    [s.profileTypeDeclared, 8],
    [s.hasHeadline, 7],
  ];
  return pct(parts.reduce((sum, [has, points]) => sum + (has ? points : 0), 0));
}

function securityScore(s: HealthSignals): number {
  // A confirmed email is the floor, not an achievement — without it nothing
  // else can be recovered, so it gates a large share.
  let score = 0;
  if (s.emailConfirmed) score += 25;
  if (s.mfaEnabled) score += 30;
  if (s.passkeyCount > 0) score += 20;
  if (s.hasRecoveryCodes) score += 15;
  if (s.hasPin) score += 10;
  return pct(score);
}

function privacyScore(s: HealthSignals): number {
  // Privacy is scored on having DECIDED, not on being locked down. A public
  // profile is a legitimate choice; never having looked is the risk.
  let score = 40; // the defaults are sane, so nobody starts at zero
  if (s.privacyReviewed) score += 35;
  if (s.activityScoped) score += 15;
  if (s.blockedOrMutedAnyone) score += 10; // evidence of using the controls
  return pct(score);
}

function contentScore(s: HealthSignals): number {
  return pct(ratio(s.posts, 5) * 0.5 + ratio(s.collections, 2) * 0.2 + ratio(s.filledModules, 4) * 0.3);
}

function communityScore(s: HealthSignals): number {
  return pct(ratio(s.friends, 5) * 0.5 + ratio(s.following, 10) * 0.5);
}

function standingScore(s: HealthSignals): number {
  if (s.suspended) return 0;
  const age = ratio(s.accountAgeDays, 90) * 0.35;
  const trust = s.trustIndex * 0.45;
  const verified = s.verified ? 20 : 0;
  return pct(age + trust + verified);
}

export function scoreBand(score: number): Band {
  if (score >= 90) return "excellent";
  if (score >= 75) return "strong";
  if (score >= 55) return "good";
  if (score >= 35) return "needs-work";
  return "critical";
}

export const BAND_LABEL: Record<Band, string> = {
  critical: "Needs attention",
  "needs-work": "Getting there",
  good: "Good",
  strong: "Strong",
  excellent: "Excellent",
};

export function computeProfileHealth(s: HealthSignals): ProfileHealth {
  const scores: Record<PillarKey, number> = {
    identity: identityScore(s),
    security: securityScore(s),
    privacy: privacyScore(s),
    content: contentScore(s),
    community: communityScore(s),
    standing: standingScore(s),
  };

  const pillars: Pillar[] = (Object.keys(PILLAR_META) as PillarKey[]).map((key) => ({
    key,
    label: PILLAR_META[key].label,
    blurb: PILLAR_META[key].blurb,
    weight: PILLAR_META[key].weight,
    score: scores[key],
  }));

  const totalWeight = pillars.reduce((sum, p) => sum + p.weight, 0);
  const score = pct(pillars.reduce((sum, p) => sum + p.score * p.weight, 0) / totalWeight);

  return {
    score,
    band: scoreBand(score),
    pillars,
    recommendations: buildRecommendations(s),
    strengths: buildStrengths(s, scores),
  };
}

/**
 * The Digital Coach.
 *
 * Only ever returns advice that is (a) currently untrue of this profile and
 * (b) fixable at the linked destination. Priority is the honest ordering:
 * losing your account outranks an empty banner, every time.
 */
function buildRecommendations(s: HealthSignals): Recommendation[] {
  const out: Recommendation[] = [];
  const add = (r: Recommendation) => out.push(r);

  /* ── Security: highest priority, because the cost of ignoring it is total ── */
  if (!s.emailConfirmed) {
    add({
      id: "confirm-email",
      pillar: "security",
      title: "Confirm your email address",
      detail: "Without a confirmed email there is no way to get back into your account if you lose your password.",
      href: "/account/security",
      priority: 100,
    });
  }
  if (!s.mfaEnabled) {
    add({
      id: "enable-mfa",
      pillar: "security",
      title: "Turn on two-factor authentication",
      detail: "A stolen password alone would be enough to take this account today.",
      href: "/account/security",
      priority: 95,
    });
  }
  if (s.mfaEnabled && !s.hasRecoveryCodes) {
    add({
      id: "recovery-codes",
      pillar: "security",
      title: "Save your recovery codes",
      detail: "Two-factor is on, so losing your phone would lock you out. Recovery codes are the way back in.",
      href: "/account/security",
      priority: 90,
    });
  }
  if (s.passkeyCount === 0) {
    add({
      id: "add-passkey",
      pillar: "security",
      title: "Add a passkey",
      detail: "Sign in with your face or fingerprint. Passkeys can't be phished the way a password can.",
      href: "/account/security",
      priority: 70,
    });
  }

  /* ── Privacy: decide, rather than drift ── */
  if (!s.privacyReviewed) {
    add({
      id: "review-privacy",
      pillar: "privacy",
      title: "Review who can see your profile",
      detail: "You're on the defaults. They're sensible, but they were chosen for you — take a minute to make them yours.",
      href: "/account/privacy",
      priority: 80,
    });
  }

  /* ── Identity ── */
  if (!s.hasHandle) {
    add({
      id: "set-handle",
      pillar: "identity",
      title: "Pick a username",
      detail: "It's the address of your profile — without one, nobody can link to you.",
      href: "/account/identity/username",
      priority: 85,
    });
  }
  if (!s.hasAvatar) {
    add({
      id: "add-avatar",
      pillar: "identity",
      title: "Add a profile picture",
      detail: "It's the first thing anyone sees of you, in the feed, in messages and on your posts.",
      href: "/account/identity/avatar",
      priority: 60,
    });
  }
  if (!s.hasBio) {
    add({
      id: "write-bio",
      pillar: "identity",
      title: "Write a short bio",
      detail: "A line or two about who you are gives a visitor a reason to follow.",
      href: "/account/identity/bio",
      priority: 55,
    });
  }
  if (!s.hasBanner) {
    add({
      id: "add-banner",
      pillar: "identity",
      title: "Add a cover image",
      detail: "The cover sets the tone of your profile before anyone reads a word.",
      href: "/account/identity",
      priority: 30,
    });
  }
  if (!s.profileTypeDeclared) {
    add({
      id: "profile-type",
      pillar: "identity",
      title: "Say what your profile is for",
      detail: "Creator, business, professional — your profile grows the right sections once it knows.",
      href: "/account/profile-type",
      priority: 45,
    });
  }
  if (s.profileTypeDeclared && !s.hasHeadline) {
    add({
      id: "add-headline",
      pillar: "identity",
      title: "Add a headline",
      detail: "One line under your name saying what you do — it appears everywhere your profile does.",
      href: "/account/professional",
      priority: 40,
    });
  }
  if (!s.hasLinks) {
    add({
      id: "add-link",
      pillar: "identity",
      title: "Add your website or link",
      detail: "Somewhere for people who like what they see to go next.",
      href: "/account/identity/links",
      priority: 25,
    });
  }

  /* ── Content ── */
  if (s.posts === 0) {
    add({
      id: "first-post",
      pillar: "content",
      title: "Publish your first post",
      detail: "An empty profile gives a visitor nothing to follow you for.",
      href: "/create/post",
      priority: 65,
    });
  }
  if (s.filledModules < 3) {
    add({
      id: "fill-sections",
      pillar: "content",
      title: "Fill in more of your profile sections",
      detail: "A section you've enabled but left empty stays hidden from visitors — only you can see it.",
      href: "/account/modules",
      priority: 35,
    });
  }
  if (s.posts > 2 && s.collections === 0) {
    add({
      id: "make-collection",
      pillar: "content",
      title: "Group your posts into a collection",
      detail: "Collections make a profile with a lot on it worth browsing rather than just scrolling.",
      href: "/saved",
      priority: 20,
    });
  }

  /* ── Community ── */
  if (s.friends === 0 && s.following < 3) {
    add({
      id: "find-people",
      pillar: "community",
      title: "Find people to follow",
      detail: "Your feed is built from who you follow — it stays quiet until you do.",
      href: "/friends/discover",
      priority: 50,
    });
  }

  /* ── Standing ── */
  if (!s.verified && s.trustIndex >= 60 && s.accountAgeDays >= 30) {
    add({
      id: "apply-verification",
      pillar: "standing",
      title: "You may be eligible for verification",
      detail: "Your account is established enough to apply for the blue tick. The checklist tells you where you stand.",
      href: "/account/verification",
      priority: 42,
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/** What's already right. Kept short — three at most, so it stays meaningful. */
function buildStrengths(s: HealthSignals, scores: Record<PillarKey, number>): string[] {
  const out: string[] = [];
  if (s.mfaEnabled && s.passkeyCount > 0) out.push("Your account is well protected");
  else if (s.mfaEnabled) out.push("Two-factor authentication is on");
  if (scores.identity >= 85) out.push("Your profile is complete");
  if (s.verified) out.push("You're verified");
  if (s.accountAgeDays >= 365) out.push("You've been here over a year");
  if (scores.content >= 80) out.push("Your profile has plenty on it");
  if (s.friends >= 5) out.push("You've built real connections here");
  return out.slice(0, 3);
}

/**
 * Declared, NOT built — the parts of the Part 15 brief that need a backend this
 * platform does not have. Listed so the roadmap is visible in the product
 * instead of quietly dropped, and so nothing here is mistaken for shipped.
 */
export const PLANNED_INTELLIGENCE: { title: string; needs: string }[] = [
  { title: "Profile insights over time", needs: "per-profile visit history — nothing records when your profile was viewed" },
  { title: "Growth trends & weekly progress", needs: "a snapshot store; today's score is a point in time, not a series" },
  { title: "Profile goals", needs: "a goals store to set and track targets against" },
  { title: "Profile snapshots", needs: "periodic saved copies of the score to compare against" },
  { title: "AI writing & layout help", needs: "a language model — the advice above is deliberately rule-based and explainable" },
  { title: "Accessibility review of your media", needs: "image analysis for alt text and contrast" },
];
