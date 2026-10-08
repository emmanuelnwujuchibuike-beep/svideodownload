/**
 * The advertiser application — its steps, its text rules and its state.
 *
 * Pure: the wizard uses it for instant feedback, the server for the verdict.
 *
 * ── Application state is DERIVED, not a second status column ───────────────
 * The campaign already has one status machine (0195). What an advertiser sees
 * (uploading, validation, ready for payment, activating, blocked …) is read off
 * that status plus the creative's verdicts by `applicationState` — so the two
 * can never disagree.
 */

import type { CampaignStatus } from "./catalog";

export const APPLICATION_STEPS = ["format", "placement", "duration", "creative", "details", "preview", "rules", "review"] as const;
export type ApplicationStep = (typeof APPLICATION_STEPS)[number];

export const STEP_LABELS: Record<ApplicationStep, string> = {
  format: "Format",
  placement: "Placement",
  duration: "Duration",
  creative: "Creative",
  details: "Details",
  preview: "Preview",
  rules: "Rules",
  review: "Review",
};

/** The steps that create server state need an account; the ones before them do not. */
export const FIRST_SIGNED_IN_STEP: ApplicationStep = "creative";

export const TEXT_LIMITS = { name: 120, businessName: 120, headline: 90, description: 240 } as const;

/**
 * Advertiser text, made inert. React renders it as text (never HTML), so this
 * is not the XSS defence — it keeps the stored row clean: no control
 * characters, no markup, no runs of whitespace, no over-long values.
 */
export function sanitizeText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A destination as the advertiser typed it, made comparable: `acme.com/x` → `https://acme.com/x`. */
export function normalizeDestination(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
}

/** The host to show the advertiser ("Destination: acme.com") — read from the string, never fetched. */
export function destinationHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export interface DetailsInput {
  name: string;
  businessName: string;
  headline: string;
  description: string;
}

export function detailsProblems(d: DetailsInput): Partial<Record<keyof DetailsInput, string>> {
  const out: Partial<Record<keyof DetailsInput, string>> = {};
  if (!sanitizeText(d.name, TEXT_LIMITS.name)) out.name = "Give your campaign a name.";
  if (!sanitizeText(d.businessName, TEXT_LIMITS.businessName)) out.businessName = "Enter your business or brand name.";
  if (d.headline.length > TEXT_LIMITS.headline) out.headline = `Keep the headline under ${TEXT_LIMITS.headline} characters.`;
  if (d.description.length > TEXT_LIMITS.description) out.description = `Keep the description under ${TEXT_LIMITS.description} characters.`;
  return out;
}

export type ApplicationState =
  | "draft"
  | "uploading"
  | "validation"
  | "validation_required"
  | "ready_for_payment"
  | "payment_processing"
  | "paid"
  | "activating"
  | "active"
  | "blocked"
  | "failed"
  | "closed";

export interface StateCreative {
  status: string;
  validation_status: string;
  url_validation_status: string;
}

/** What the advertiser sees, read off the ONE campaign status and the creative verdicts. */
export function applicationState(status: CampaignStatus, creatives: readonly StateCreative[], uploading = false): ApplicationState {
  const live = creatives.filter((c) => c.status === "active");
  if (status === "draft" || status === "awaiting_payment") {
    if (uploading) return "uploading";
    if (live.some((c) => c.validation_status === "blocked" || c.url_validation_status === "blocked")) return "blocked";
    if (live.some((c) => c.validation_status === "invalid")) return "failed";
    if (live.some((c) => c.validation_status === "pending")) return "validation";
    return status === "awaiting_payment" ? "ready_for_payment" : "draft";
  }
  switch (status) {
    case "payment_processing":
      return "payment_processing";
    case "paid":
      return "activating";
    case "validating":
      return "validation_required";
    case "active":
      return "active";
    case "rejected":
      return "blocked";
    default:
      return "closed";
  }
}

export const APPLICATION_STATE_LABELS: Record<ApplicationState, string> = {
  draft: "Draft",
  uploading: "Uploading",
  validation: "Checking your creative",
  validation_required: "Under review",
  ready_for_payment: "Ready for payment",
  payment_processing: "Payment processing",
  paid: "Paid",
  activating: "Going live",
  active: "Live",
  blocked: "Blocked",
  failed: "Needs a new upload",
  closed: "Closed",
};
