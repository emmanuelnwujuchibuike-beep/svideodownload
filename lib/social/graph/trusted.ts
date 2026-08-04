/**
 * Trusted contacts — capability registry (Feature 18 · Part 17).
 *
 * ── The most dangerous item in the brief ──────────────────────────────────
 * "Trusted contacts for account recovery" is a sentence that describes a
 * complete authentication system. If it half-works, it is not a missing
 * feature — it is a way into someone's account. Every real implementation of
 * it needs an out-of-band challenge, a waiting period, a notification the
 * account holder can veto, rate limiting, and an audit trail, because the
 * threat model is a person who KNOWS the victim: an abusive partner is
 * exactly the "trusted contact" this feature would hand the keys to.
 *
 * So recovery is `live: false` here and the API refuses to store it. What
 * ships is the honest subset: a member can RECORD who matters, and the record
 * grants nothing. That is genuinely useful — support has someone to point to,
 * and the member has stated their wishes — while being impossible to misuse,
 * because there is no capability attached to abuse.
 *
 * The UI must say so in as many words. A screen titled "Trusted contacts"
 * that does not state plainly that it grants no access is worse than no
 * screen, because a member could reasonably believe they have set up recovery
 * and stop keeping their own recovery codes.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type TrustedCapabilityKey = "emergency" | "legacy" | "recovery" | "business_delegate" | "creator_manager";

export interface TrustedCapabilitySpec {
  key: TrustedCapabilityKey;
  label: string;
  blurb: string;
  /** True only when the capability can be honoured end-to-end today. */
  live: boolean;
  /** Exactly what a live version would require. */
  needs?: string;
  /**
   * What this actually grants. For every live capability today the answer is
   * "nothing" — and saying so is the point.
   */
  grants: string;
}

export const TRUSTED_CAPABILITIES: readonly TrustedCapabilitySpec[] = [
  {
    key: "emergency",
    label: "Emergency contact",
    blurb: "The person you'd want reached if something happened to you.",
    live: true,
    grants: "Nothing. It is a record of your wishes — it gives them no access to your account.",
  },
  {
    key: "legacy",
    label: "Digital legacy contact",
    blurb: "Who you'd want your account handled by.",
    live: true,
    grants: "Nothing today. Your wishes are on file for our support team; no access is granted or implied.",
  },
  {
    key: "recovery",
    label: "Account recovery",
    blurb: "Let this person help you back into your account.",
    live: false,
    needs:
      "An out-of-band challenge, a mandatory waiting period, a veto notification to the account holder, rate limiting and an audit trail. Without all five it is an account-takeover path for someone who knows the member personally.",
    grants: "Would grant a route into your account — which is exactly why it is not switched on.",
  },
  {
    key: "business_delegate",
    label: "Business delegate",
    blurb: "Let someone act for your business profile.",
    live: false,
    needs:
      "Delegated authorisation: scoped permissions, revocation, and an audit of who did what. `profile_team_members` (0110) is display-only and must not be mistaken for this.",
    grants: "Would let another account change your profile and your prices.",
  },
  {
    key: "creator_manager",
    label: "Creator manager",
    blurb: "Let a manager handle your creator account.",
    live: false,
    needs: "The same delegated authorisation as a business delegate, plus payout scoping.",
    grants: "Would let another account act as you.",
  },
] as const;

export function trustedCapability(key: string): TrustedCapabilitySpec | undefined {
  return TRUSTED_CAPABILITIES.find((c) => c.key === key);
}

export function liveTrustedCapabilities(): TrustedCapabilitySpec[] {
  return TRUSTED_CAPABILITIES.filter((c) => c.live);
}

/** The API's guard. Anything not explicitly live is refused. */
export function canDesignate(key: string): boolean {
  return trustedCapability(key)?.live === true;
}

/**
 * A member cannot name an unlimited number of people. Small on purpose: the
 * value of the list is that it is short enough to mean something.
 */
export const MAX_TRUSTED_CONTACTS = 5;

/**
 * The line the UI must show, verbatim, on every trusted-contact screen.
 * Exported so the copy cannot drift from the guarantee the code makes.
 */
export const TRUSTED_NO_ACCESS_NOTICE =
  "Naming someone here gives them no access to your account and no control over it. It records your wishes, nothing more.";
