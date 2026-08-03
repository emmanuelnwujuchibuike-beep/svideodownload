/**
 * Verification types + option tables — the half of `verification.ts` that is
 * safe on the client.
 *
 * `verification.ts` is `server-only` (it holds the service-role reads and the
 * approve/reject writes), so the application form cannot import from it. These
 * are pure data with no Supabase reference, shared by both sides so the labels
 * a member picks from and the labels a reviewer reads are literally the same list.
 */

export type VerificationStatus =
  | "draft"
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "withdrawn";

export type VerificationCategory =
  | "creator"
  | "business"
  | "public_figure"
  | "journalist"
  | "government"
  | "other";

export type IdDocumentType = "passport" | "national_id" | "drivers_license" | "residence_permit";

export const VERIFICATION_CATEGORIES: { value: VerificationCategory; label: string; blurb: string }[] = [
  { value: "creator", label: "Creator", blurb: "You publish original content to an audience." },
  { value: "business", label: "Business", blurb: "You represent a registered company or brand." },
  { value: "public_figure", label: "Public figure", blurb: "You are notable outside this platform." },
  { value: "journalist", label: "Journalist", blurb: "You report for a recognised publication." },
  { value: "government", label: "Government", blurb: "You represent a public body or official." },
  { value: "other", label: "Other", blurb: "None of the above describes you." },
];

export const ID_DOCUMENT_TYPES: { value: IdDocumentType; label: string }[] = [
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID card" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "residence_permit", label: "Residence permit" },
];

export const REJECTION_CODES: { value: string; label: string }[] = [
  { value: "name_mismatch", label: "Name doesn't match the document" },
  { value: "unreadable", label: "Document image unreadable" },
  { value: "selfie_mismatch", label: "Selfie doesn't match the document" },
  { value: "document_expired", label: "Document expired" },
  { value: "not_eligible", label: "Doesn't meet the eligibility bar" },
  { value: "duplicate", label: "Duplicate or impersonating account" },
  { value: "other", label: "Other (explained below)" },
];

export interface VerificationRequest {
  id: string;
  userId: string;
  status: VerificationStatus;
  category: VerificationCategory;
  legalName: string | null;
  knownAs: string | null;
  country: string | null;
  idDocumentType: IdDocumentType | null;
  idNumberLast4: string | null;
  idFrontPath: string | null;
  idBackPath: string | null;
  selfiePath: string | null;
  links: string[];
  statement: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  rejectionCode: string | null;
  issuedDirectly: boolean;
  submittedAt: string | null;
  createdAt: string;
}

export interface VerificationState {
  verified: boolean;
  request: VerificationRequest | null;
}

export interface EligibilityCriterion {
  key: string;
  label: string;
  detail: string;
  met: boolean;
  /** A criterion that only strengthens an application, rather than gating it. */
  optional?: boolean;
}

export interface Eligibility {
  eligible: boolean;
  criteria: EligibilityCriterion[];
  /** How many of the "prove you're real" signals they cleared, out of how many. */
  metCount: number;
  requiredCount: number;
}

/** Minimum account age before an application is accepted. */
export const MIN_ACCOUNT_AGE_DAYS = 30;
/** Reach bar — met by followers OR a paid plan, so a small business can still apply. */
export const MIN_FOLLOWERS = 100;

export interface EligibilityInput {
  createdAt: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  followers: number;
  posts: number;
  emailConfirmed: boolean;
  suspended: boolean;
  paidPlan: boolean;
}

/**
 * The gate, computed entirely from real account data. The member sees exactly
 * these rows with exactly these outcomes — the checklist IS the rule, so nobody
 * is turned away by something they cannot see.
 */
export function checkEligibility(input: EligibilityInput): Eligibility {
  const ageDays = Math.floor((Date.now() - new Date(input.createdAt).getTime()) / 86_400_000);

  const criteria: EligibilityCriterion[] = [
    {
      key: "age",
      label: `Account at least ${MIN_ACCOUNT_AGE_DAYS} days old`,
      detail: ageDays >= MIN_ACCOUNT_AGE_DAYS ? `${ageDays} days old` : `${MIN_ACCOUNT_AGE_DAYS - ageDays} days to go`,
      met: ageDays >= MIN_ACCOUNT_AGE_DAYS,
    },
    {
      key: "email",
      label: "Email address confirmed",
      detail: input.emailConfirmed ? "Confirmed" : "Confirm your email first",
      met: input.emailConfirmed,
    },
    {
      key: "handle",
      label: "Username set",
      detail: input.handle ? `@${input.handle}` : "Pick a username in Identity",
      met: !!input.handle,
    },
    {
      key: "complete",
      label: "Profile complete",
      detail: "A display name, a profile picture and a bio",
      met: !!input.displayName && !!input.avatarUrl && !!input.bio,
    },
    {
      key: "active",
      label: "Published something",
      detail: input.posts > 0 ? `${input.posts} post${input.posts === 1 ? "" : "s"}` : "Publish at least one post",
      met: input.posts > 0,
    },
    {
      key: "reach",
      label: `${MIN_FOLLOWERS}+ followers, or a paid plan`,
      detail: input.paidPlan ? "Paid plan" : `${input.followers} of ${MIN_FOLLOWERS} followers`,
      met: input.followers >= MIN_FOLLOWERS || input.paidPlan,
    },
    {
      key: "standing",
      label: "Account in good standing",
      detail: input.suspended ? "Account is suspended" : "No active restrictions",
      met: !input.suspended,
    },
  ];

  const metCount = criteria.filter((c) => !c.optional && c.met).length;
  const requiredCount = criteria.filter((c) => !c.optional).length;
  return { eligible: metCount === requiredCount, criteria, metCount, requiredCount };
}

/** One line for the Settings list row. */
export function verificationSummary(state: VerificationState): string {
  if (state.verified) return "Verified account";
  switch (state.request?.status) {
    case "pending":
    case "in_review":
      return "Application under review";
    case "rejected":
      return "Application declined — you can reapply";
    case "draft":
      return "Application started";
    default:
      return "Apply for the blue tick";
  }
}
