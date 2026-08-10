import { DATA_DOMAINS, type DataDomain } from "@/lib/platform/data-domains";

/**
 * Data Portability™ — Feature 18 · Part 24.
 *
 * ── The defect this is built around ──────────────────────────────────────────
 * `/api/account/export` already existed and already worked. It hand-lists nine
 * tables:
 *
 *   profiles, posts, post_comments, follows (×2), blocks, muted_creators,
 *   privacy_settings, security_audit_log
 *
 * The database has well over a hundred. So the export was not wrong, it was
 * SILENTLY INCOMPLETE — and, worse, incomplete in a way that gets worse on its
 * own. Every table added since was absent from the export and nothing failed:
 * not a type, not a test, not a lint rule. A person who exercised their right
 * to a copy of their data received a file that looked complete, and neither
 * they nor we had any way to know what was missing.
 *
 * That is a compliance problem before it is an engineering one. GDPR Article 20
 * is about ALL the personal data concerning the subject, and "we forgot the
 * table" is not a defence.
 *
 * ── Why this hangs off the domain catalogue ──────────────────────────────────
 * `lib/platform/data-domains.ts` already maps every table in the schema into a
 * domain, and `data-domains.test.ts` already fails the build when a migration
 * introduces a table that is not catalogued. That test is the enforcement point
 * this feature needs and it is already load-bearing.
 *
 * So portability is declared PER DOMAIN, not per table. A new table added to an
 * existing domain inherits that domain's export decision automatically, and a
 * new DOMAIN cannot ship without one — `registry.test.ts` fails on a domain
 * with no portability entry, the same shape of guard one level up.
 *
 * The alternative — a second list of tables here — is the "second registry"
 * this codebase has removed three times, and it would drift the same way the
 * hardcoded export already did.
 */

/**
 * Does a domain hold data ABOUT a person, and may they take it with them?
 *
 * `personal` — the member's own data. Exportable, and part of a subject access
 *   request.
 * `operational` — real data that is not about one member (platform settings,
 *   feature flags, locales). Not exportable because there is nothing personal
 *   in it to export.
 * `restricted` — personal, but must NOT be handed over in bulk. The cases are
 *   narrow and each is named individually below, because "we withheld it" is a
 *   claim that has to be justified per domain rather than by category.
 */
export type DataClass = "personal" | "operational" | "restricted";

export interface PortabilitySpec {
  /** The domain id from DATA_DOMAINS. */
  domain: string;
  dataClass: DataClass;
  /**
   * What this holds, for a person rather than an engineer. Rendered verbatim in
   * the Transparency Dashboard, so it must read as an answer to "what is this?"
   */
  holds: string;
  /** Why we have it at all. The question a privacy dashboard exists to answer. */
  purpose: string;
  /** How long it is kept, in plain words. "As long as your account exists" is a
   *  real answer; "varies" is not. */
  retention: string;
  /** Required whenever dataClass is "restricted" — the justification. */
  withheldBecause?: string;
}

/**
 * One entry per domain. Ordered as the dashboard lists them: the things a
 * person recognises first.
 */
export const PORTABILITY: PortabilitySpec[] = [
  {
    domain: "identity",
    dataClass: "personal",
    holds: "Your profile, handle and bio, plus the settings that protect your account.",
    purpose: "It is your account. Without it there is nobody to sign in as.",
    retention: "As long as your account exists.",
  },
  {
    domain: "social",
    dataClass: "personal",
    holds: "Your posts, comments, reactions and polls.",
    purpose: "It is what you made, shown to whoever you chose to show it to.",
    retention: "Until you delete it, or delete your account.",
  },
  {
    domain: "life-memories",
    dataClass: "personal",
    holds: "Your private journal entries and time capsules.",
    purpose: "A private plane that only you can read.",
    retention: "Until you delete them.",
  },
  {
    domain: "profile-platform",
    dataClass: "personal",
    holds: "The modules, details and credentials that make up your profile page.",
    purpose: "To render your profile the way you arranged it.",
    retention: "As long as your account exists.",
  },
  {
    domain: "social-graph",
    dataClass: "personal",
    holds: "Your circles, relationship labels and trusted contacts.",
    purpose: "To decide who sees what, without you re-deciding every time.",
    retention: "As long as your account exists.",
  },
  {
    domain: "discovery",
    dataClass: "personal",
    holds: "Your bookmarks, bookmark lists and discovery preferences.",
    purpose: "So the things you saved stay findable.",
    retention: "Until you remove them.",
  },
  {
    domain: "messaging",
    dataClass: "restricted",
    holds: "Your conversations and their attachments.",
    purpose: "To deliver messages between you and the people you talk to.",
    retention: "Until you or the other person deletes them.",
    withheldBecause:
      "A conversation belongs to everyone in it. A bulk export would hand over other people's messages — which they never consented to and cannot object to, because they would not know it happened. Your own messages are yours; the thread is not solely yours to take.",
  },
  {
    domain: "media",
    dataClass: "personal",
    holds: "Your uploads and your download history.",
    purpose: "So your library follows you, and a file you saved can be found again.",
    retention: "Until you remove them.",
  },
  {
    domain: "monetization",
    dataClass: "personal",
    holds: "Your plan, subscriptions and billing history.",
    purpose: "To know what you have paid for, and to give you a record of it.",
    retention: "Billing records are kept for the period tax law requires, even after deletion.",
  },
  {
    domain: "moderation",
    dataClass: "restricted",
    holds: "Reports you made, and moderation decisions about your content.",
    purpose: "To act on reports and to let you appeal a decision.",
    retention: "Kept as a record of the decision.",
    withheldBecause:
      "A bulk export would reveal who reported whom. Reporting only works while it is not a way to find out who reported you. Decisions about YOUR content are exportable; the identity of the person who reported it is not.",
  },
  {
    domain: "feedback",
    dataClass: "personal",
    holds: "Ratings and feedback you have given the app.",
    purpose: "To know what to fix, and to stop asking you once you have answered.",
    retention: "As long as your account exists.",
  },
  {
    domain: "support",
    dataClass: "personal",
    holds: "Your support conversations with us.",
    purpose: "So a question you asked last month is still there when you follow it up.",
    retention: "Kept while your account exists, so a thread is not lost mid-conversation.",
  },
  {
    domain: "wallpapers",
    dataClass: "personal",
    holds: "Wallpapers you liked, saved or commented on.",
    purpose: "To keep your saved set, and to rank what is popular.",
    retention: "Until you remove them, or the wallpaper is taken down.",
  },
  {
    domain: "verification",
    dataClass: "restricted",
    holds: "Your verification requests and their outcomes.",
    purpose: "To make a decision, and to be able to show why it was made.",
    retention: "Kept as a record of the decision.",
    withheldBecause:
      "These can carry identity documents you supplied and notes written by reviewers. The decision and its date are exportable; the reviewer's working notes are not, because publishing them would show anyone how to pass the check.",
  },
  {
    domain: "notifications",
    dataClass: "personal",
    holds: "Your notification settings and what has been sent to you.",
    purpose: "To send you what you asked for and nothing else.",
    retention: "Settings persist; delivery history is short-lived.",
  },
  {
    domain: "content",
    dataClass: "operational",
    holds: "The published help, guides and knowledge base.",
    purpose: "It is the product's own content, not yours.",
    retention: "As long as the article exists.",
  },
  {
    domain: "learning",
    dataClass: "personal",
    holds: "Your progress through guides and lessons.",
    purpose: "To carry on where you left off.",
    retention: "As long as your account exists.",
  },
  {
    domain: "localization",
    dataClass: "operational",
    holds: "Languages and the translation catalogue.",
    purpose: "It runs the product. None of it is about you.",
    retention: "As long as the locale exists.",
  },
  {
    domain: "analytics",
    dataClass: "operational",
    holds: "Aggregate traffic and usage counts.",
    purpose: "To understand how the product is used, in aggregate.",
    retention: "Kept as aggregates rather than as a record about you.",
  },
  {
    domain: "configuration",
    dataClass: "operational",
    holds: "Feature flags, experiments and platform settings.",
    purpose: "It runs the product. None of it is about you.",
    retention: "As long as the setting exists.",
  },
  {
    domain: "audit",
    dataClass: "personal",
    holds: "The security events on your account — sign-ins, password changes, new devices.",
    purpose: "So you can see what happened to your account and when.",
    retention: "Kept as a security record; it is what an investigation would rely on.",
  },
];

const BY_DOMAIN = new Map(PORTABILITY.map((p) => [p.domain, p]));

export function portabilityFor(domainId: string): PortabilitySpec | null {
  return BY_DOMAIN.get(domainId) ?? null;
}

/** Domains a member may take with them. */
export function exportableDomains(): DataDomain[] {
  return DATA_DOMAINS.filter((d) => portabilityFor(d.id)?.dataClass === "personal");
}

/**
 * Every table an export is expected to cover.
 *
 * Derived from the catalogue, which is why a new table in an existing domain is
 * covered the moment the migration lands — the failure mode this whole file
 * exists to remove.
 */
export function exportableTables(): string[] {
  return exportableDomains().flatMap((d) => [...d.tables]).sort();
}

/** Domains that are personal but deliberately not handed over in bulk. */
export function restrictedDomains(): { domain: DataDomain; spec: PortabilitySpec }[] {
  return DATA_DOMAINS.flatMap((domain) => {
    const spec = portabilityFor(domain.id);
    return spec?.dataClass === "restricted" ? [{ domain, spec }] : [];
  });
}

/** Domains that hold nothing about any individual. */
export function operationalDomains(): DataDomain[] {
  return DATA_DOMAINS.filter((d) => portabilityFor(d.id)?.dataClass === "operational");
}

/**
 * Domains catalogued in the schema but never given a portability decision.
 *
 * Should always be empty; `registry.test.ts` fails when it is not. This is the
 * guard that makes completeness structural rather than remembered — the same
 * shape `data-domains.test.ts` already applies one level down to tables.
 */
export function undeclaredDomains(): string[] {
  return DATA_DOMAINS.filter((d) => !BY_DOMAIN.has(d.id)).map((d) => d.id);
}
