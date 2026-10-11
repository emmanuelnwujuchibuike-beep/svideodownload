/**
 * Relationship Reputation™ (Feature 19 · Part 16) — the pure rules.
 *
 * NOT a popularity score. Its inputs are verification, account age, recent
 * participation, mutual relationships, work others vouched for, contributions
 * (reports that moderators acted on, moderating, recognition, mentoring) and
 * rule compliance. Followers, likes, views, money and virality are not inputs —
 * the input type below has no field for them, and a test holds it to that.
 *
 * The output is a LEVEL (a title, never a number), earned BADGES (each with why),
 * strengths and improvements in words, and the recovery that applies. Negative
 * signals only ever come from a moderator's decision (an upheld report), and they
 * stop counting after twelve months, or at once when an appeal overturns them —
 * long-term positive participation repairs standing (Reputation Recovery™).
 *
 * Separate from the Feature 18 "Reputation" ranks (lib/social/reputation.ts),
 * which do weigh followers and engagement; see docs/FEATURE_19_SOCIAL_GRAPH.md.
 */

export interface ReputationInput {
  verified: boolean;
  accountAgeDays: number;
  /** posts and comments in the last 90 days */
  activity90: number;
  friends: number;
  collaborations: number;
  recommendations: number;
  endorsers: number;
  /** reports this member filed that a moderator acted on */
  helpfulReports: number;
  /** creator communities where they are an active moderator */
  moderatorOf: number;
  /** active members in the member's own community */
  communityMembers: number;
  /** recognitions creators gave them (helpful, trusted, constructive…) */
  recognitions: number;
  /** confirmed connections where they are the mentor */
  mentees: number;
  profileType: string | null;
  /** upheld reports in the last 12 months, and older ones (which no longer count) */
  upheldRecent: number;
  upheldOlder: number;
  /** appeals a moderator overturned in their favour */
  overturnedAppeals: number;
  restricted: boolean;
}

export const LEVELS = ["Emerging", "Established", "Trusted", "Distinguished", "Respected", "Pioneer", "Legacy"] as const;
export type Level = (typeof LEVELS)[number];

export interface Badge {
  key: string;
  label: string;
  why: string;
}

export interface Reputation {
  level: Level;
  levelWhy: string;
  badges: Badge[];
  strengths: string[];
  improvements: string[];
  recovery: string[];
  limited: boolean;
}

export function relationshipReputation(r: ReputationInput): Reputation {
  const badges: Badge[] = [];
  const strengths: string[] = [];
  const improvements: string[] = [];
  const recovery: string[] = [];
  const clean = r.upheldRecent === 0;
  const vouched = r.collaborations + r.recommendations + r.endorsers;

  if (r.verified) badges.push({ key: "verified", label: "Verified Identity", why: "Your identity was verified by Frenz." });
  if (clean && r.profileType === "creator" && r.collaborations >= 2 && r.activity90 >= 5) badges.push({ key: "creator", label: "Trusted Creator", why: "You post regularly, collaborate with others, and have no upheld reports this year." });
  if (clean && r.profileType === "business" && r.verified) badges.push({ key: "business", label: "Trusted Business", why: "A verified business account in good standing." });
  if (clean && r.mentees >= 2) badges.push({ key: "mentor", label: "Trusted Mentor", why: `${r.mentees} people confirmed you mentored them.` });
  if (clean && r.moderatorOf >= 1) badges.push({ key: "moderator", label: "Trusted Moderator", why: "A creator chose you to moderate their community." });
  if (clean && r.communityMembers >= 10) badges.push({ key: "leader", label: "Community Leader", why: `You lead a community of ${r.communityMembers} members in good standing.` });
  if (r.helpfulReports >= 3) badges.push({ key: "safety", label: "Safety Contributor", why: "Moderators acted on reports you made — you help keep Frenz safe." });

  if (r.verified) strengths.push("Verified identity");
  if (r.accountAgeDays >= 365) strengths.push("On Frenz for over a year");
  if (r.activity90 >= 10) strengths.push("Consistently active");
  if (vouched >= 3) strengths.push("Others have vouched for your work");
  if (r.recognitions >= 1) strengths.push("Recognised by creators you support");
  if (r.helpfulReports >= 1) strengths.push("You report abuse that moderators act on");

  if (!r.verified) improvements.push("Verify your account");
  if (r.activity90 === 0) improvements.push("Take part now and then: post, comment or help someone");
  if (vouched === 0) improvements.push("Collaborate, or ask someone you worked with for a recommendation");
  if (r.upheldRecent > 0) improvements.push("Keep within the community rules — upheld reports stop counting after twelve months");

  if (r.upheldOlder > 0) recovery.push(`${r.upheldOlder} older ${r.upheldOlder === 1 ? "report no longer counts" : "reports no longer count"} — twelve months of good standing repaired them.`);
  if (r.overturnedAppeals > 0) recovery.push(`${r.overturnedAppeals} ${r.overturnedAppeals === 1 ? "decision was" : "decisions were"} overturned on appeal and removed.`);

  if (r.restricted) return { level: "Emerging", levelWhy: "The team has limited this account. The Transparency Center explains why and how to appeal.", badges: badges.filter((b) => b.key === "verified"), strengths, improvements, recovery, limited: true };

  const years = r.accountAgeDays / 365;
  const established = r.accountAgeDays >= 30 && (r.activity90 >= 1 || r.friends >= 1);
  const trusted = established && clean && (r.verified || vouched >= 2) && r.friends >= 3;
  const earned = badges.filter((b) => b.key !== "verified").length;
  let level: Level = "Emerging";
  let levelWhy = "Every member starts here. Participation, time and trust move you forward.";
  if (established) [level, levelWhy] = ["Established", "You've been here a while and take part."];
  if (trusted) [level, levelWhy] = ["Trusted", "Real relationships, good standing, and someone has vouched for you or your identity is verified."];
  if (trusted && earned >= 1) [level, levelWhy] = ["Distinguished", "Trusted, with a role others recognise."];
  if (trusted && earned >= 2 && years >= 1 && vouched >= 5) [level, levelWhy] = ["Respected", "Over a year of trusted participation, vouched for by many."];
  if (trusted && earned >= 3 && years >= 2) [level, levelWhy] = ["Pioneer", "A long-standing member who helps build the community."];
  if (trusted && earned >= 3 && years >= 3 && vouched >= 10) [level, levelWhy] = ["Legacy", "Years of trusted contribution across Frenz."];
  return { level, levelWhy, badges, strengths, improvements: improvements.slice(0, 4), recovery, limited: false };
}
