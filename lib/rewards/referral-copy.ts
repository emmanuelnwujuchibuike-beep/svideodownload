/**
 * The referral sentence the download banner shows (owner, 2026-10-07: "sign in
 * 2 credits, top up 10 credits, subscribe 10 credits"). Pure, from the LIVE
 * amounts — the banner never writes a number of its own.
 */
export interface ReferralAmounts {
  signup: number;
  topup: number;
  subscribe: number;
}

const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

/** "Share your Frenzsave link. Earn 2 credits when someone you invite signs up, and 10 credits every time they top up or subscribe." */
export function referralSentence(rules: { referral?: ReferralAmounts }, fallback: number): string {
  const r = rules.referral;
  if (!r) return `Share your Frenzsave link and earn ${credits(fallback)} when someone you invite joins and uses Frenzsave.`;
  const parts: string[] = [];
  if (r.signup > 0) parts.push(`${credits(r.signup)} when someone you invite signs up`);
  if (r.topup > 0 && r.topup === r.subscribe) parts.push(`${credits(r.topup)} every time they top up or subscribe`);
  else {
    if (r.topup > 0) parts.push(`${credits(r.topup)} every time they top up`);
    if (r.subscribe > 0) parts.push(`${credits(r.subscribe)} every time they subscribe`);
  }
  if (!parts.length) return `Share your Frenzsave link and earn ${credits(fallback)} when someone you invite joins.`;
  const last = parts.pop()!;
  return `Share your Frenzsave link. Earn ${parts.length ? `${parts.join(", ")}, and ${last}` : last}.`;
}
