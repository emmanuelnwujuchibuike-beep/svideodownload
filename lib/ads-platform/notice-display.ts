import type { AdNotice } from "./ad-notify";

/**
 * The view counts in an advertiser notice, as the campaign dashboard shows them
 * (owner, 2026-10-14: "the push notification stats should be the x10 from the
 * user dashboard").
 *
 * The admin sample mode (`stats_multiplier`, 0212) scales delivered views on the
 * dashboard, capped at the target (dashboard-data.ts `loadViewsTerms`). The
 * notices were worded from the real count, so "views to go" read far higher in
 * the push than on the page the push opens. Display only, like the dashboard:
 * delivery, extensions and refunds still run on the real number.
 *
 * Returns null when, as the dashboard shows it, nothing is left to deliver: a
 * "N views to go" with N = 0 would contradict the page, so that notice is not sent.
 */
export function noticeAsDisplayed(n: AdNotice, targetViews: number | null, multiplier: number): AdNotice | null {
  if (!targetViews || multiplier <= 1) return n;
  const shown = (remaining: number) => {
    const delivered = Math.max(0, targetViews - remaining);
    return Math.max(0, targetViews - Math.min(targetViews, delivered * multiplier));
  };
  switch (n.kind) {
    case "delivery_extended":
    case "deadline_soon": {
      const remaining = shown(n.remaining);
      return remaining > 0 ? { ...n, remaining } : null;
    }
    case "delivery_shortfall": {
      // a refund is real money: the notice always goes, with the dashboard's figure when it has one
      const shortfall = shown(n.shortfall);
      return { ...n, shortfall: shortfall > 0 ? shortfall : n.shortfall };
    }
    default:
      return n;
  }
}
