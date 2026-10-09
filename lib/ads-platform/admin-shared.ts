/**
 * Part 7 — what the admin desk and its server agree on: the views, the
 * moderation actions, which action fits which status, and the words for each
 * review flag. Plain data (no server import) so the lazy admin panel can use it.
 * The database re-checks every action (admin_moderate_ad_campaign, 0204).
 */

export const ADMIN_CAMPAIGN_VIEWS = ["review", "live", "refunds", "all"] as const;
export type AdminCampaignView = (typeof ADMIN_CAMPAIGN_VIEWS)[number];

export const MODERATION_ACTIONS = ["approve", "reject", "pause", "resume", "remove"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const ADVERTISER_STATUSES = ["active", "restricted", "suspended", "disabled"] as const;
export type AdvertiserStatus = (typeof ADVERTISER_STATUSES)[number];

/** The actions that make sense from each status — the database re-checks every one. */
export function actionsFor(status: string): ModerationAction[] {
  switch (status) {
    case "paid":
    case "validating":
      return ["approve", "reject", "remove"];
    case "active":
      return ["pause", "remove"];
    case "paused":
      return ["resume", "remove"];
    case "expired":
    case "rejected":
    case "cancelled":
    case "draft":
    case "awaiting_payment":
    case "payment_processing":
      return ["remove"];
    default:
      return [];
  }
}

/** Why a campaign is waiting, in words an admin acts on. */
export const FLAG_WORDS: Record<string, string> = {
  advertiser_not_active: "The advertiser is not active",
  placement_disabled: "The placement is switched off",
  format_disabled: "The ad format is switched off",
  no_creative: "No creative uploaded",
  format_mismatch: "The creative is the wrong format for the placement",
  validation_pending: "The creative has not been checked yet",
  creative_invalid: "The creative failed its checks",
  destination_not_valid: "The link is unchecked or blocked",
  placement_full: "Every slot in the placement is taken",
  safety_review: "The content safety check wants a person to look",
};

