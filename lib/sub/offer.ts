import { usd } from "@/lib/creator/membership/engine";

import { inRenewWindow, RENEW_WINDOW_DAYS } from "./lifecycle";

/**
 * What the creator subscription card says (Frenz Exclusive Part 4). Pure, so every state is
 * tested without a browser. Every number comes from the server's quote (`subTabFor` → price +
 * the platform fee, the same numbers checkout charges); nothing here invents or defaults a
 * price. There is no automatic renewal: an ended subscription is renewed by paying again.
 */

export interface OfferQuote {
  priceCents: number;
  feeCents: number;
  totalCents: number;
  feePercent: number;
  periodDays: number;
}

export type OfferMembership = { state: "active"; until: string | null } | { state: "expired"; endedAt: string | null } | { state: "none" };

export type OfferAction = "subscribe" | "renew" | "sign_in" | "none";

export interface OfferView {
  /** the card's state, for the UI's look */
  tone: "offer" | "active" | "expired" | "unavailable";
  title: string;
  /** what the visitor pays, per period, including the fee — e.g. "$11.00 for 30 days" */
  priceLine: string | null;
  /** how that total is made up — e.g. "$10.00 to the creator + $1.00 service fee" */
  feeLine: string | null;
  /** a status sentence (subscribed until, ended on, not taking subscriptions) */
  status: string | null;
  action: OfferAction;
  actionLabel: string | null;
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : null);

export function offerView(input: { creatorName: string; quote: OfferQuote | null; membership: OfferMembership | undefined; signedIn: boolean; now?: number }): OfferView {
  const { creatorName, quote, membership, signedIn } = input;
  const now = input.now ?? Date.now();
  const priced = quote && quote.totalCents > 0 && quote.periodDays > 0 ? quote : null;
  const priceLine = priced ? `${usd(priced.totalCents)} for ${priced.periodDays} days` : null;
  const feeLine = priced ? (priced.feeCents > 0 ? `${usd(priced.priceCents)} to ${creatorName} + ${usd(priced.feeCents)} service fee` : `All of it goes to ${creatorName}`) : null;

  if (membership?.state === "active") {
    const until = day(membership.until);
    // Part 5: in the last RENEW_WINDOW_DAYS, renewing early adds a period from the current end (checkout refuses it before then)
    if (priced && signedIn && inRenewWindow(membership.until, now)) {
      return { tone: "active", title: `You're subscribed to ${creatorName}`, priceLine, feeLine, status: `Access until ${until}. Renew now to add ${priced.periodDays} days from then.`, action: "renew", actionLabel: "Renew early" };
    }
    return { tone: "active", title: `You're subscribed to ${creatorName}`, priceLine: null, feeLine: null, status: until ? `Access until ${until}. It doesn't renew automatically. You can renew in the last ${RENEW_WINDOW_DAYS} days.` : "Your subscription is active.", action: "none", actionLabel: null };
  }
  if (!priced) {
    return { tone: "unavailable", title: `${creatorName} isn't taking new subscriptions right now`, priceLine: null, feeLine: null, status: null, action: "none", actionLabel: null };
  }
  if (!signedIn) {
    return { tone: "offer", title: `Subscribe to ${creatorName}`, priceLine, feeLine, status: null, action: "sign_in", actionLabel: "Sign in to subscribe" };
  }
  if (membership?.state === "expired") {
    const ended = day(membership.endedAt);
    return { tone: "expired", title: `Renew your subscription to ${creatorName}`, priceLine, feeLine, status: ended ? `Your subscription ended on ${ended}.` : "Your subscription has ended.", action: "renew", actionLabel: "Renew" };
  }
  return { tone: "offer", title: `Subscribe to ${creatorName}`, priceLine, feeLine, status: null, action: "subscribe", actionLabel: "Subscribe" };
}
