/**
 * Professional Network™ — the pure rules (Feature 19 · Part 12).
 *
 * ── What already existed, and is reused ───────────────────────────────────
 *   profile_details (0107)       headline, category, skills, languages,
 *                                availability, résumé, country
 *   profile_credentials (0107)   experience, education, certifications,
 *                                awards, publications, projects — the
 *                                Career Timeline is DERIVED from these
 *   /u/<handle>/card             the Digital Business Card with its QR
 *   relationship_labels (0112)   private words like "Colleague", "Mentor"
 *
 * ── What is new: relationships both people confirm ────────────────────────
 * A private label is one person's note. A professional relationship ("Ada was
 * my manager at Acme") says something about BOTH people, so it exists only
 * when both agree: one asks, naming each side's role, the other confirms.
 * Recommendations are shown only after the person they are about approves
 * them. Endorsements come only from people who know you (a confirmed
 * connection or a friend), and only for skills you list.
 *
 * ── Never a popularity contest ────────────────────────────────────────────
 * Professional Reputation is a private checklist of things that build trust,
 * each with how to meet it. There is no score, no rank, no follower count in
 * it, and nobody else sees it. The Network Assistant explains every suggestion
 * in words, from public profile facts and confirmed relationships only.
 *
 * Pure: no React, no Supabase, no I/O.
 */

// ─── Roles ───────────────────────────────────────────────────────────────────

export const PRO_ROLES = {
  colleague: "Colleague",
  manager: "Manager",
  report: "Direct report",
  employer: "Employer",
  employee: "Employee",
  recruiter: "Recruiter",
  candidate: "Candidate",
  mentor: "Mentor",
  mentee: "Mentee",
  client: "Client",
  customer: "Customer",
  freelancer: "Freelancer",
  consultant: "Consultant",
  contractor: "Contractor",
  agency: "Agency",
  vendor: "Vendor",
  supplier: "Supplier",
  investor: "Investor",
  advisor: "Advisor",
  founder: "Founder",
  partner: "Partner",
  custom: "Other",
} as const;
export type ProRole = keyof typeof PRO_ROLES;
export const PRO_ROLE_KEYS = Object.keys(PRO_ROLES) as ProRole[];
export function isProRole(v: unknown): v is ProRole {
  return typeof v === "string" && v in PRO_ROLES;
}

/** If THEY are `role` to you, what can YOU be to them? The first is the default. */
export const ROLE_INVERSES: Record<ProRole, readonly ProRole[]> = {
  colleague: ["colleague"],
  manager: ["report"],
  report: ["manager"],
  employer: ["employee", "candidate", "recruiter"],
  employee: ["employer"],
  recruiter: ["candidate", "employer"],
  candidate: ["recruiter", "employer"],
  mentor: ["mentee"],
  mentee: ["mentor"],
  client: ["freelancer", "consultant", "contractor", "agency", "vendor", "supplier"],
  customer: ["vendor", "supplier"],
  freelancer: ["client"],
  consultant: ["client"],
  contractor: ["client"],
  agency: ["client"],
  vendor: ["client", "customer"],
  supplier: ["client", "customer"],
  investor: ["founder"],
  advisor: ["founder"],
  founder: ["investor", "advisor", "partner"],
  partner: ["partner", "founder"],
  custom: ["custom"],
};

export function rolePairAllowed(theirRole: string, yourRole: string): boolean {
  return isProRole(theirRole) && isProRole(yourRole) && ROLE_INVERSES[theirRole].includes(yourRole);
}

/** The groups the dashboard counts. */
export const ROLE_GROUP: Record<ProRole, "colleagues" | "mentors" | "clients" | "hiring" | "investment" | "partners"> = {
  colleague: "colleagues",
  manager: "colleagues",
  report: "colleagues",
  employer: "hiring",
  employee: "colleagues",
  recruiter: "hiring",
  candidate: "hiring",
  mentor: "mentors",
  mentee: "mentors",
  client: "clients",
  customer: "clients",
  freelancer: "clients",
  consultant: "clients",
  contractor: "clients",
  agency: "clients",
  vendor: "clients",
  supplier: "clients",
  investor: "investment",
  advisor: "investment",
  founder: "investment",
  partner: "partners",
  custom: "partners",
};

// ─── Collaboration status (what a member is open to, professionally) ─────────

export const PRO_OPEN_TO = {
  work: "Available for work",
  hiring: "Hiring",
  freelance: "Open to freelance",
  partnerships: "Open to partnerships",
  investors: "Seeking investors",
  mentoring: "Open to mentoring",
  mentee: "Looking for a mentor",
  speaking: "Open to speaking",
} as const;
export type ProOpenTo = keyof typeof PRO_OPEN_TO;
export const PRO_OPEN_TO_KEYS = Object.keys(PRO_OPEN_TO) as ProOpenTo[];
export function isProOpenTo(v: unknown): v is ProOpenTo {
  return typeof v === "string" && v in PRO_OPEN_TO;
}

// ─── Recommendations, endorsements, opportunities ────────────────────────────

export const REC_KINDS = {
  recommendation: "Recommendation",
  testimonial: "Testimonial",
  client_review: "Client review",
  reference: "Business reference",
  mentor_review: "Mentor review",
} as const;
export type RecKind = keyof typeof REC_KINDS;
export function isRecKind(v: unknown): v is RecKind {
  return typeof v === "string" && v in REC_KINDS;
}

export const OPPORTUNITY_KINDS = {
  job: "Open position",
  internship: "Internship",
  freelance: "Freelance",
  volunteer: "Volunteer",
  partnership: "Partnership",
  research: "Research position",
  creator: "Creator hiring",
} as const;
export type OpportunityKind = keyof typeof OPPORTUNITY_KINDS;
export function isOpportunityKind(v: unknown): v is OpportunityKind {
  return typeof v === "string" && v in OPPORTUNITY_KINDS;
}

export const REC_MIN = 20;
export const REC_MAX = 1500;
export const NOTE_MAX = 300;
export const CONTEXT_MAX = 80;
export const CUSTOM_ROLE_MAX = 40;
export const MAX_OPEN_OPPORTUNITIES = 20;
export const PENDING_REQUESTS_PER_DAY = 30;

const tidy = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const LINKS = /https?:\/\/|www\./gi;

/** A recommendation is words about a person: no markup, at most one link, a real length. */
export function validateRecommendation(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = tidy(raw);
  if (v.length < REC_MIN) return { ok: false, error: `Write at least ${REC_MIN} characters.` };
  if (v.length > REC_MAX) return { ok: false, error: `Keep it under ${REC_MAX} characters.` };
  if (/[<>]/.test(v)) return { ok: false, error: "Plain text only." };
  if ((v.match(LINKS) ?? []).length > 1) return { ok: false, error: "One link at most." };
  return { ok: true, value: v };
}

export function validateShortText(raw: string | null | undefined, max: number): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = raw ? tidy(raw) : "";
  if (!v) return { ok: true, value: null };
  if (v.length > max) return { ok: false, error: `Keep it under ${max} characters.` };
  if (/[<>]/.test(v)) return { ok: false, error: "Plain text only." };
  return { ok: true, value: v };
}

/** Only https links leave the platform from an opportunity. */
export function validateLink(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = raw?.trim();
  if (!v) return { ok: true, value: null };
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return { ok: false, error: "Use an https:// link." };
    if (v.length > 300) return { ok: false, error: "That link is too long." };
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false, error: "That link isn't valid." };
  }
}

export interface OpportunityInput {
  kind: string;
  title: string;
  description?: string | null;
  location?: string | null;
  remote?: boolean;
  link?: string | null;
}

export function validateOpportunity(o: OpportunityInput): { ok: true; value: { kind: OpportunityKind; title: string; description: string | null; location: string | null; remote: boolean; link: string | null } } | { ok: false; error: string } {
  if (!isOpportunityKind(o.kind)) return { ok: false, error: "Choose what kind of opportunity it is." };
  const title = tidy(o.title ?? "");
  if (title.length < 3 || title.length > 80) return { ok: false, error: "Give it a title of 3 to 80 characters." };
  if (/[<>]/.test(title)) return { ok: false, error: "Plain text only." };
  const description = validateShortText(o.description, 1500);
  if (!description.ok) return description;
  const location = validateShortText(o.location, 80);
  if (!location.ok) return location;
  const link = validateLink(o.link);
  if (!link.ok) return link;
  return { ok: true, value: { kind: o.kind, title, description: description.value, location: location.value, remote: !!o.remote, link: link.value } };
}

// ─── Career Timeline™ ────────────────────────────────────────────────────────

export interface TimelineCredential {
  id: string;
  kind: string;
  title: string;
  organization: string | null;
  startedOn: string | null;
  endedOn: string | null;
  isCurrent: boolean;
}

export interface CareerItem {
  key: string;
  kind: "experience" | "education" | "certification" | "award" | "publication" | "project" | "connection" | "recommendation";
  title: string;
  sub: string | null;
  when: string | null;
  /** sortable, larger = more recent; current roles sort first */
  sortKey: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "Mar 2019", "2019", "Summer 2019", an ISO date → year*12+month, or null. Free text never throws. */
export function dateKey(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})/.exec(raw);
  if (iso) return Number(iso[1]) * 12 + Number(iso[2]) - 1;
  const year = /\b(19|20)\d{2}\b/.exec(raw);
  if (!year) return null;
  const m = MONTHS.findIndex((x) => raw.toLowerCase().includes(x));
  return Number(year[0]) * 12 + (m >= 0 ? m : 0);
}

export function careerTimeline(input: {
  credentials: readonly TimelineCredential[];
  connections: readonly { id: string; name: string; theirRole: string; customLabel: string | null; context: string | null; at: string }[];
  recommendations: readonly { id: string; authorName: string; kind: string; at: string }[];
  now: Date;
}): CareerItem[] {
  const nowKey = input.now.getUTCFullYear() * 12 + input.now.getUTCMonth();
  const items: CareerItem[] = [];
  for (const c of input.credentials) {
    const kind = (["experience", "education", "certification", "award", "publication", "project"] as const).find((k) => k === c.kind);
    if (!kind) continue;
    const start = dateKey(c.startedOn);
    const end = c.isCurrent ? nowKey + 1 : dateKey(c.endedOn) ?? start;
    const span = [c.startedOn, c.isCurrent ? "now" : c.endedOn].filter(Boolean).join(" to ");
    items.push({ key: `cred-${c.id}`, kind, title: c.title, sub: c.organization, when: span || null, sortKey: end ?? -1 });
  }
  for (const c of input.connections) {
    const d = new Date(c.at);
    const role = c.theirRole === "custom" ? c.customLabel ?? "Connection" : PRO_ROLES[c.theirRole as ProRole] ?? "Connection";
    items.push({ key: `conn-${c.id}`, kind: "connection", title: `Connected with ${c.name}`, sub: [role, c.context].filter(Boolean).join(", "), when: d.toISOString().slice(0, 7), sortKey: d.getUTCFullYear() * 12 + d.getUTCMonth() });
  }
  for (const r of input.recommendations) {
    const d = new Date(r.at);
    items.push({ key: `rec-${r.id}`, kind: "recommendation", title: `${REC_KINDS[r.kind as RecKind] ?? "Recommendation"} from ${r.authorName}`, sub: null, when: d.toISOString().slice(0, 7), sortKey: d.getUTCFullYear() * 12 + d.getUTCMonth() });
  }
  return items.sort((a, b) => b.sortKey - a.sortKey || a.title.localeCompare(b.title));
}

// ─── Professional Reputation™ (private, no score) ────────────────────────────

export interface TrustFactor {
  key: string;
  label: string;
  met: boolean;
  how: string;
}

export function trustFactors(s: { verified: boolean; hasHeadline: boolean; skills: number; credentials: number; connections: number; recommendations: number; endorsers: number; accountDays: number }): TrustFactor[] {
  return [
    { key: "verified", label: "Verified identity", met: s.verified, how: "Verify your account in Settings." },
    { key: "profile", label: "A headline and your skills", met: s.hasHeadline && s.skills >= 3, how: "Add a one-line headline and at least three skills." },
    { key: "history", label: "Your experience or education", met: s.credentials >= 1, how: "Add a role, a school or a certification." },
    { key: "connections", label: "People who confirm they worked with you", met: s.connections >= 3, how: "Ask three people you've worked with to confirm it." },
    { key: "recommendations", label: "A recommendation you approved", met: s.recommendations >= 1, how: "Ask someone who knows your work to recommend you." },
    { key: "endorsements", label: "Skills endorsed by people who know you", met: s.endorsers >= 3, how: "Endorsements come from confirmed connections and friends." },
    { key: "tenure", label: "Here for a while", met: s.accountDays >= 90, how: "This one only takes time." },
  ];
}

// ─── AI Network Assistant™ (explainable) ─────────────────────────────────────

export interface AssistantCandidate {
  id: string;
  openTo: string[];
  skills: string[];
  organizations: string[];
  /** ids of THEIR confirmed professional connections */
  connectedTo: readonly string[];
}

export interface AssistantSuggestion {
  id: string;
  reasons: string[];
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Who might be worth knowing, and why, in words. Every reason is a public
 * profile fact or a confirmed relationship. People already connected, asked,
 * blocked or dismissed are passed in `exclude` and never suggested.
 */
export function networkSuggestions(me: { openTo: readonly string[]; skills: readonly string[]; organizations: readonly string[]; connections: ReadonlySet<string> }, candidates: readonly AssistantCandidate[], exclude: ReadonlySet<string>, nameOf: (id: string) => string, limit = 12): AssistantSuggestion[] {
  const mySkills = new Set(me.skills.map(norm));
  const myOrgs = new Set(me.organizations.map(norm).filter((o) => o.length > 1));
  const iWant = new Set(me.openTo);
  const out: (AssistantSuggestion & { weight: number })[] = [];
  for (const c of candidates) {
    if (exclude.has(c.id)) continue;
    const reasons: string[] = [];
    let weight = 0;
    const sharedOrgs = c.organizations.filter((o) => myOrgs.has(norm(o)));
    if (sharedOrgs.length) {
      reasons.push(`You were both at ${sharedOrgs[0]}`);
      weight += 3;
    }
    const via = c.connectedTo.filter((id) => me.connections.has(id));
    if (via.length) {
      reasons.push(`Worked with ${nameOf(via[0]!)}${via.length > 1 ? ` and ${via.length - 1} more you know` : ""}`);
      weight += 2;
    }
    const sharedSkills = c.skills.filter((s) => mySkills.has(norm(s)));
    if (iWant.has("hiring") && c.openTo.includes("work") && sharedSkills.length) {
      reasons.push(`Available for work, with ${sharedSkills.slice(0, 2).join(" and ")}`);
      weight += 3;
    } else if (iWant.has("work") && c.openTo.includes("hiring")) {
      reasons.push("Hiring");
      weight += 2;
    }
    if (iWant.has("mentee") && c.openTo.includes("mentoring")) {
      reasons.push(sharedSkills.length ? `Mentors in ${sharedSkills[0]}` : "Open to mentoring");
      weight += 2;
    }
    if (iWant.has("mentoring") && c.openTo.includes("mentee")) {
      reasons.push("Looking for a mentor");
      weight += 1;
    }
    if (iWant.has("investors") && c.openTo.includes("partnerships")) {
      reasons.push("Open to partnerships");
      weight += 1;
    }
    if (iWant.has("freelance") && c.openTo.includes("hiring")) {
      if (!reasons.includes("Hiring")) reasons.push("Hiring");
      weight += 1;
    }
    if (!reasons.length && sharedSkills.length >= 2) {
      reasons.push(`Shares your skills: ${sharedSkills.slice(0, 2).join(", ")}`);
      weight += 1;
    }
    if (reasons.length) out.push({ id: c.id, reasons, weight });
  }
  return out
    .sort((a, b) => b.weight - a.weight || b.reasons.length - a.reasons.length)
    .slice(0, limit)
    .map(({ id, reasons }) => ({ id, reasons }));
}

// ─── Business relationship history ───────────────────────────────────────────

export interface HistoryEvent {
  at: string;
  label: string;
}

export function relationshipHistory(input: { requestedAt: string; acceptedAt: string | null; recommendations: readonly { at: string; fromMe: boolean; kind: string }[]; endorsements: readonly { at: string; fromMe: boolean; skill: string }[] }): HistoryEvent[] {
  const ev: HistoryEvent[] = [{ at: input.requestedAt, label: "Connection requested" }];
  if (input.acceptedAt) ev.push({ at: input.acceptedAt, label: "Connected" });
  for (const r of input.recommendations) ev.push({ at: r.at, label: `${REC_KINDS[r.kind as RecKind] ?? "Recommendation"} ${r.fromMe ? "given" : "received"}` });
  for (const e of input.endorsements) ev.push({ at: e.at, label: `${e.skill} endorsed ${e.fromMe ? "by you" : "for you"}` });
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}
