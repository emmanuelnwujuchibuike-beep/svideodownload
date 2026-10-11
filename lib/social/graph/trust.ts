/**
 * Trust Graph™ (Feature 19 · Part 15) — explainable, never a vanity number.
 *
 * Trust is read from things that show an account is real and behaves well:
 * verification, age, recent participation, mutual relationships, work others
 * vouched for (collaborations, accepted recommendations, endorsements), and rule
 * compliance (only UPHELD reports count — an unreviewed or dismissed report never
 * lowers anyone). Follower counts and likes are deliberately NOT signals: they
 * reward reach, not trustworthiness.
 *
 * The result is a band with the reasons behind it, in words. It is shown to the
 * person themselves (so they can see why) and is available to the server for
 * safety decisions — it is never shown to other members as a score.
 *
 * Pure. The server read is trust-server.ts.
 */

export interface TrustSignals {
  verified: boolean;
  accountAgeDays: number;
  /** posts and comments in the last 90 days */
  activity90: number;
  /** friendships (mutual by definition) */
  friends: number;
  /** accepted post collaborations */
  collaborations: number;
  /** accepted recommendations received */
  recommendations: number;
  /** skill endorsements received (distinct endorsers) */
  endorsers: number;
  /** reports against them or their posts that a moderator UPHELD */
  upheldReports: number;
  /** suspended, hidden or withdrawal-restricted by the team */
  restricted: boolean;
}

export type TrustBand = "new" | "building" | "established" | "trusted" | "limited";

export interface TrustResult {
  band: TrustBand;
  label: string;
  reasons: { good: boolean; text: string }[];
  /** what would move the band up, honestly (empty when nothing would) */
  next: string[];
}

const LABEL: Record<TrustBand, string> = { new: "New account", building: "Building trust", established: "Established", trusted: "Trusted member", limited: "Limited" };

export function trustFromSignals(s: TrustSignals): TrustResult {
  const reasons: TrustResult["reasons"] = [];
  const next: string[] = [];
  if (s.restricted) return { band: "limited", label: LABEL.limited, reasons: [{ good: false, text: "The team has limited this account" }], next: ["Contact support to review the restriction"] };
  let points = 0;
  if (s.verified) { points += 3; reasons.push({ good: true, text: "Verified identity" }); }
  else next.push("Verify your account");
  if (s.accountAgeDays >= 365) { points += 2; reasons.push({ good: true, text: "On Frenz for over a year" }); }
  else if (s.accountAgeDays >= 30) { points += 1; reasons.push({ good: true, text: `On Frenz for ${Math.floor(s.accountAgeDays / 30)} months` }); }
  else reasons.push({ good: false, text: "A new account (under 30 days)" });
  if (s.activity90 >= 10) { points += 2; reasons.push({ good: true, text: "Regularly active in the last 3 months" }); }
  else if (s.activity90 >= 1) { points += 1; reasons.push({ good: true, text: "Some recent activity" }); }
  else next.push("Post or comment now and then");
  if (s.friends >= 10) { points += 2; reasons.push({ good: true, text: `${s.friends} mutual friendships` }); }
  else if (s.friends >= 1) { points += 1; reasons.push({ good: true, text: s.friends === 1 ? "A mutual friendship" : `${s.friends} mutual friendships` }); }
  else next.push("Make a few friends");
  const vouched = s.collaborations + s.recommendations + s.endorsers;
  if (vouched >= 3) { points += 2; reasons.push({ good: true, text: "Others have vouched for your work" }); }
  else if (vouched >= 1) { points += 1; reasons.push({ good: true, text: "Someone has vouched for your work" }); }
  if (s.upheldReports >= 3) { points -= 4; reasons.push({ good: false, text: "Several reports were upheld by moderators" }); }
  else if (s.upheldReports >= 1) { points -= 2; reasons.push({ good: false, text: "A report was upheld by moderators" }); }
  const band: TrustBand = s.accountAgeDays < 30 && points < 4 ? "new" : points >= 9 ? "trusted" : points >= 5 ? "established" : "building";
  return { band, label: LABEL[band], reasons, next: band === "trusted" ? [] : next.slice(0, 3) };
}
