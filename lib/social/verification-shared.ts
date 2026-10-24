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

// 2026-10-24 (owner): the eligibility checklist (account age, followers, profile, posts…) is GONE — any member may
// apply for review or buy the tick. A suspended account is still refused at submit (app/api/verification/route.ts).

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
