/**
 * Creator Relationship Platform™ — the pure rules (Feature 19 · Part 13).
 *
 * ── SUB is money, never credits ──────────────────────────────────────────
 * Owner brief 2026-10-11: a paid subscription is bought through Paystack in real
 * money (integer USD cents, charged in naira at the live rate), the subscriber
 * pays the creator's price PLUS a purchase fee, and the creator's earnings sit in
 * a SUB balance of their own (0227) that never touches the AI credit wallet. A SUB
 * withdrawal pays out through Paystack less a withdrawal fee. The fee arithmetic
 * is below and mirrored in SQL; tests pin both.
 *
 * ── Communities before numbers ────────────────────────────────────────────
 * Titles are mature (Member, Supporter, Inner circle, VIP member…). Loyalty is
 * time, participation and contribution, NEVER money: nothing here sorts or
 * ranks people by what they paid, and there is no public spending list.
 *
 * Pure: no React, no Supabase, no I/O.
 */

// ─── Roles and memberships ───────────────────────────────────────────────────

export const MEMBER_ROLES = {
  member: "Member",
  supporter: "Supporter",
  inner_circle: "Inner circle",
  vip: "VIP member",
  moderator: "Moderator",
  partner: "Creator partner",
  brand_partner: "Brand partner",
  team: "Team member",
} as const;
export type MemberRole = keyof typeof MEMBER_ROLES;
export function isMemberRole(v: unknown): v is MemberRole {
  return typeof v === "string" && v in MEMBER_ROLES;
}
/** Who sees a note written for a role: that role and every role above it. */
export const ROLE_RANK: Record<MemberRole, number> = { member: 0, supporter: 1, inner_circle: 2, vip: 3, moderator: 3, partner: 3, brand_partner: 1, team: 4 };

// ─── SUB money (mirrors settle_sub_purchase / request_sub_withdrawal in 0227) ─

/** Basis points from a percentage (10 % = 1000, 7.3 % = 730), so the TypeScript and the SQL agree to the cent. */
export const feeBasisPoints = (feePercent: number) => Math.min(10_000, Math.max(0, Math.round(feePercent * 100)));

/**
 * What a subscriber pays: the creator's price plus the purchase fee ON TOP. The creator
 * earns the full price, the platform the fee. Integer cents; the fee rounds DOWN, so a
 * subscriber is never charged a fraction more than the advertised percentage.
 * $10.00 at 10 % → fee $1.00, total $11.00.
 */
export function subscriptionCharge(priceCents: number, feePercent: number): { priceCents: number; feeCents: number; totalCents: number; feeBp: number } {
  const price = Math.max(0, Math.floor(priceCents));
  const feeBp = feeBasisPoints(feePercent);
  const feeCents = Math.floor((price * feeBp) / 10_000);
  return { priceCents: price, feeCents, totalCents: price + feeCents, feeBp };
}

/**
 * A SUB withdrawal: the fee comes OUT of the amount requested. Same rounding as the SQL
 * (integer division). $100.00 at 10 % → fee $10.00, paid $90.00.
 */
export function withdrawalSplit(grossCents: number, feePercent: number): { grossCents: number; feeCents: number; netCents: number; feeBp: number } {
  const gross = Math.max(0, Math.floor(grossCents));
  const feeBp = feeBasisPoints(feePercent);
  const feeCents = Math.floor((gross * feeBp) / 10_000);
  return { grossCents: gross, feeCents, netCents: gross - feeCents, feeBp };
}

/** "$11.00" — every SUB amount shown is integer cents formatted once, here. */
export const usd = (cents: number) => `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A creator's price must sit inside the admin's bounds, in whole cents. */
export function validatePrice(priceCents: number, bounds: { minPriceCents: number; maxPriceCents: number }): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(priceCents) || priceCents < bounds.minPriceCents || priceCents > bounds.maxPriceCents) return { ok: false, error: `Set a price from ${usd(bounds.minPriceCents)} to ${usd(bounds.maxPriceCents)}.` };
  return { ok: true };
}

/** The four onboarding steps of "Get paid for your content". */
export const SETUP_STEPS = ["price", "earn", "payout", "done"] as const;

// ─── Loyalty Intelligence™ (private to the creator, never money) ─────────────

export interface MemberSignals {
  memberId: string;
  joinedAt: string;
  /** comments on the creator's posts in the last 90 days */
  comments90: number;
  /** posts made together (accepted collaborations) */
  collaborations: number;
  /** recognitions the creator gave them */
  recognitions: string[];
  /** reports about them that were upheld */
  upheldReports: number;
  /** last activity with the creator's content */
  lastActiveAt: string | null;
}

const DAY = 86_400_000;

/** Words, never a score. Built from time, participation and contribution only. */
export function loyaltyNotes(s: MemberSignals, now: number): string[] {
  const out: string[] = [];
  const days = Math.floor((now - Date.parse(s.joinedAt)) / DAY);
  if (days >= 365) out.push("Member for over a year");
  else if (days >= 30) out.push("Member for over a month");
  else out.push("New member");
  if (s.comments90 >= 10) out.push("Takes part often");
  else if (s.comments90 >= 3) out.push("Takes part");
  if (s.collaborations > 0) out.push("Has created with you");
  if (s.recognitions.includes("helpful") || s.recognitions.includes("constructive")) out.push("Helps others");
  return out;
}

// ─── Member milestones ───────────────────────────────────────────────────────

export function memberMilestone(joinedAt: string, now: Date): { label: string; at: string } | null {
  const j = new Date(joinedAt);
  const days = (now.getTime() - j.getTime()) / DAY;
  for (const [months, label] of [[12 * 5, "Five years"], [12 * 2, "Two years"], [12, "One year"], [6, "Six months"], [1, "One month"]] as const) {
    const at = new Date(j.getTime());
    at.setUTCMonth(at.getUTCMonth() + months);
    const since = (now.getTime() - at.getTime()) / DAY;
    if (since >= 0 && since < 7 && days >= 28) return { label: `${label} of membership`, at: at.toISOString() };
  }
  return null;
}

// ─── Fan Insights™ (aggregated, with a floor) ────────────────────────────────

/** A bucket smaller than this is shown as "Other", so no single member can be picked out. */
export const INSIGHT_FLOOR = 5;

export function aggregate(values: readonly (string | null)[], floor = INSIGHT_FLOOR): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = v?.trim();
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const out: { label: string; count: number }[] = [];
  let other = 0;
  for (const [label, count] of m) {
    if (count >= floor) out.push({ label, count });
    else other += count;
  }
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (other >= floor) out.push({ label: "Other", count: other });
  return out;
}

/** Of members who joined at least `days` ago, how many are still members. null when fewer than the floor joined that long ago. */
export function retention(members: readonly { joinedAt: string; endedAt: string | null }[], days: number, now: number, floor = INSIGHT_FLOOR): { kept: number; of: number } | null {
  const cohort = members.filter((m) => now - Date.parse(m.joinedAt) >= days * DAY);
  if (cohort.length < floor) return null;
  const kept = cohort.filter((m) => !m.endedAt || Date.parse(m.endedAt) - Date.parse(m.joinedAt) >= days * DAY).length;
  return { kept, of: cohort.length };
}

/** New members per calendar month, last six months. */
export function joinsByMonth(joinedAt: readonly string[], now: Date): { month: string; count: number }[] {
  const out: { month: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    out.push({ month: key, count: joinedAt.filter((j) => j.slice(0, 7) === key).length });
  }
  return out;
}

// ─── Creator reputation (members rate privately; shown only in aggregate) ───

export const FEEDBACK_ASPECTS = {
  communication: "Communication",
  professionalism: "Professionalism",
  quality: "Content quality",
  reliability: "Reliability",
  education: "Educational value",
  community: "Community health",
} as const;
export type FeedbackAspect = keyof typeof FEEDBACK_ASPECTS;

/** Averages per aspect, only once at least INSIGHT_FLOOR members have answered: no one answer can be traced. */
export function feedbackSummary(rows: readonly Partial<Record<FeedbackAspect, number | null>>[], floor = INSIGHT_FLOOR): { aspect: FeedbackAspect; average: number; answers: number }[] | null {
  if (rows.length < floor) return null;
  return (Object.keys(FEEDBACK_ASPECTS) as FeedbackAspect[])
    .map((aspect) => {
      const v = rows.map((r) => r[aspect]).filter((x): x is number => typeof x === "number" && x >= 1 && x <= 5);
      return { aspect, average: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : 0, answers: v.length };
    })
    .filter((a) => a.answers >= floor);
}

// ─── Fan reputation (the creator's private recognitions) ─────────────────────

export const RECOGNITIONS = {
  helpful: "Helpful member",
  trusted: "Trusted member",
  volunteer_moderator: "Volunteer moderator",
  constructive: "Constructive contributor",
  collaborator: "Reliable collaborator",
  super_supporter: "Super supporter",
} as const;
export type Recognition = keyof typeof RECOGNITIONS;
export function isRecognition(v: unknown): v is Recognition {
  return typeof v === "string" && v in RECOGNITIONS;
}

// ─── Sponsors (always disclosed) ─────────────────────────────────────────────

export const SPONSOR_KINDS = { brand: "Brand", partner: "Partner", investor: "Investor", organization: "Organization", education: "Educational sponsor", community: "Community sponsor" } as const;
export type SponsorKind = keyof typeof SPONSOR_KINDS;
export function isSponsorKind(v: unknown): v is SponsorKind {
  return typeof v === "string" && v in SPONSOR_KINDS;
}

// ─── AI Community Assistant™ (explainable) ───────────────────────────────────

export interface CommunitySuggestion {
  id: string;
  title: string;
  line: string;
  memberIds?: string[];
}

export function communitySuggestions(input: { members: readonly (MemberSignals & { role: MemberRole })[]; lastNoteAt: string | null; lastPostAt: string | null; now: number }): CommunitySuggestion[] {
  const out: CommunitySuggestion[] = [];
  const { members, now } = input;
  // future moderators: long-standing, active, helpful, never reported, not already in a role
  const mods = members.filter((m) => m.role === "member" || m.role === "supporter").filter((m) => now - Date.parse(m.joinedAt) >= 90 * DAY && m.comments90 >= 10 && m.upheldReports === 0);
  if (mods.length) out.push({ id: "moderators", title: `${mods.length === 1 ? "A member" : `${mods.length} members`} could help moderate`, line: "Members for three months or more, who take part often and have never been reported.", memberIds: mods.slice(0, 5).map((m) => m.memberId) });
  // collaborations: members who already made something with you
  const collab = members.filter((m) => m.collaborations > 0);
  if (collab.length) out.push({ id: "collaborate", title: "Create with your members again", line: `${collab.length === 1 ? "One member has" : `${collab.length} members have`} made a post with you before.`, memberIds: collab.slice(0, 5).map((m) => m.memberId) });
  // quiet community
  const lastWord = [input.lastNoteAt, input.lastPostAt].filter((x): x is string => !!x).map((x) => Date.parse(x)).sort((a, b) => b - a)[0];
  if (members.length >= 3 && (!lastWord || now - lastWord > 21 * DAY)) out.push({ id: "quiet", title: "Your members haven't heard from you lately", line: "A short note for members only keeps a community warm. Nothing is sent automatically." });
  // inactive members
  const inactive = members.filter((m) => !m.lastActiveAt || now - Date.parse(m.lastActiveAt) > 60 * DAY);
  if (members.length >= 5 && inactive.length / members.length >= 0.5) out.push({ id: "inactive", title: "Half your members have been quiet", line: "Members who haven't engaged in two months. An event or a question often brings people back." });
  // welcome
  const fresh = members.filter((m) => now - Date.parse(m.joinedAt) < 7 * DAY);
  if (fresh.length) out.push({ id: "welcome", title: `Welcome ${fresh.length === 1 ? "your newest member" : `${fresh.length} new members`}`, line: "Joined this week.", memberIds: fresh.slice(0, 5).map((m) => m.memberId) });
  return out.slice(0, 5);
}

// ─── Validation ──────────────────────────────────────────────────────────────

const tidy = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export function validatePlain(raw: string | null | undefined, min: number, max: number, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = raw ? tidy(raw) : "";
  if (!v) return min > 0 ? { ok: false, error: `Write the ${label}.` } : { ok: true, value: null };
  if (v.length < min) return { ok: false, error: `The ${label} needs at least ${min} characters.` };
  if (v.length > max) return { ok: false, error: `Keep the ${label} under ${max} characters.` };
  if (/[<>]/.test(v)) return { ok: false, error: "Plain text only." };
  return { ok: true, value: v };
}

/** CSV of members for the creator's own export. Cells can never run as formulas. */
export function membersCsv(rows: readonly { handle: string; name: string; role: string; tier: string | null; status: string; joinedAt: string; country: string | null }[]): string {
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  return [["handle", "name", "role", "tier", "status", "joined", "country"].map(cell).join(","), ...rows.map((r) => [`@${r.handle}`, r.name, r.role, r.tier ?? "", r.status, r.joinedAt.slice(0, 10), r.country ?? ""].map(cell).join(","))].join("\r\n");
}
