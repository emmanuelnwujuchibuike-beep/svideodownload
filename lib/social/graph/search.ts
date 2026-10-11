/**
 * Graph Search (Feature 19 · Part 15) — natural questions over YOUR network.
 *
 * "Friends from university", "business partners in Lagos", "photography creators
 * I know", "people from my community", "AI collaborators", "trusted mentors".
 * The parser turns a question into filters it can show back; the server runs
 * them over the people the asker is already connected to (never the whole site),
 * and only over facts those people made public on their profile (location, bio,
 * profile type, education, skills) — nothing private about anyone is searched.
 *
 * Pure. The server executor is graph-server.ts.
 */

export type GraphRelation = "friends" | "following" | "followers" | "known" | "pro" | "collaborators" | "community" | "subscribers" | "trusted";

export interface GraphQuery {
  relations: GraphRelation[];
  /** professional roles the person has toward the asker (pro_connections) */
  roles: string[];
  profileTypes: string[];
  place: string | null;
  education: boolean;
  topics: string[];
}

const ROLE_WORDS: [RegExp, string[]][] = [
  [/\bmentors?\b/, ["mentor"]],
  [/\bmentees?\b/, ["mentee"]],
  [/\b(business )?partners?\b/, ["partner", "founder", "investor", "advisor"]],
  [/\b(colleagues?|co-?workers?|teammates?)\b/, ["colleague", "manager", "report"]],
  [/\bclients?\b/, ["client", "customer"]],
  [/\binvestors?\b/, ["investor"]],
  [/\b(employers?|bosses?)\b/, ["employer", "manager"]],
  [/\bfreelancers?\b/, ["freelancer", "consultant", "contractor"]],
  [/\brecruiters?\b/, ["recruiter"]],
];

const STOP = new Set(["i", "know", "my", "me", "the", "a", "an", "from", "in", "at", "of", "people", "person", "who", "are", "with", "and", "that", "all", "show", "find"]);

export function parseGraphQuery(raw: string): GraphQuery {
  let q = ` ${raw.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ")} `;
  const relations: GraphRelation[] = [];
  const take = (re: RegExp, rel: GraphRelation) => {
    if (re.test(q)) {
      relations.push(rel);
      q = q.replace(re, " ");
    }
  };
  take(/\bfollowers?\b/, "followers");
  take(/\b(i follow|following)\b/, "following");
  take(/\bfriends?\b/, "friends");
  take(/\bcollaborators?\b/, "collaborators");
  take(/\b(my )?community\b|\bmembers?\b/, "community");
  take(/\bsubscribers?\b/, "subscribers");
  take(/\btrusted\b/, "trusted");
  if (/\bi know\b/.test(q)) relations.push("known");
  const roles: string[] = [];
  for (const [re, rs] of ROLE_WORDS)
    if (re.test(q)) {
      roles.push(...rs);
      q = q.replace(re, " ");
    }
  if (roles.length && !relations.includes("pro")) relations.push("pro");
  const profileTypes: string[] = [];
  if (/\bcreators?\b/.test(q)) { profileTypes.push("creator"); q = q.replace(/\bcreators?\b/, " "); }
  if (/\b(businesses|brands?|companies)\b/.test(q)) { profileTypes.push("business"); q = q.replace(/\b(businesses|brands?|companies)\b/, " "); }
  let place: string | null = null;
  const placeM = /\b(?:in|from|based in|living in)\s+([\p{L}][\p{L}' -]{1,40}?)(?=\s(?:who|and|with)\b|\s*$)/u.exec(q);
  let education = false;
  if (/\b(university|uni|college|school|campus|classmates?)\b/.test(q)) {
    education = true;
    q = q.replace(/\b(from )?(university|uni|college|school|campus|classmates?)\b/g, " ");
  } else if (placeM) {
    place = placeM[1]!.trim();
    q = q.replace(placeM[0], " ");
  }
  const topics = q.split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));
  return { relations: relations.length ? relations : ["known"], roles: [...new Set(roles)], profileTypes, place, education, topics };
}

/** A sentence saying what the search understood — shown above the results. */
export function describeGraphQuery(q: GraphQuery): string {
  const rel: Record<GraphRelation, string> = { friends: "friends", following: "people you follow", followers: "your followers", known: "people you know", pro: "professional connections", collaborators: "collaborators", community: "your community", subscribers: "your subscribers", trusted: "trusted contacts" };
  const parts = [q.relations.map((r) => rel[r]).join(" or ")];
  if (q.roles.length) parts.push(`as ${q.roles.slice(0, 3).join("/")}`);
  if (q.profileTypes.length) parts.push(`who are ${q.profileTypes.map((t) => `${t}s`).join(" or ")}`);
  if (q.education) parts.push("you share a school or university with");
  if (q.place) parts.push(`in ${q.place}`);
  if (q.topics.length) parts.push(`about ${q.topics.join(", ")}`);
  return parts.join(" ");
}

export interface GraphPerson {
  id: string;
  relations: GraphRelation[];
  roles: string[];
  profileType: string | null;
  location: string | null;
  bio: string | null;
  skills: string[];
  schools: string[];
}

/** Does a person match the parsed question? `mySchools` is the asker's own education, for "from university". */
export function matchesGraphQuery(p: GraphPerson, q: GraphQuery, mySchools: readonly string[]): boolean {
  const rel = q.relations.some((r) => (r === "known" ? p.relations.some((x) => x === "friends" || x === "following" || x === "pro") : p.relations.includes(r)));
  if (!rel) return false;
  if (q.roles.length && !p.roles.some((r) => q.roles.includes(r))) return false;
  if (q.profileTypes.length && !q.profileTypes.includes(p.profileType ?? "")) return false;
  if (q.place && !(p.location ?? "").toLowerCase().includes(q.place.toLowerCase())) return false;
  if (q.education) {
    const mine = mySchools.map((s) => s.toLowerCase());
    if (!p.schools.some((s) => mine.some((m) => m && (s.toLowerCase().includes(m) || m.includes(s.toLowerCase()))))) return false;
  }
  if (q.topics.length) {
    const hay = `${p.bio ?? ""} ${p.skills.join(" ")}`.toLowerCase();
    if (!q.topics.every((t) => hay.includes(t))) return false;
  }
  return true;
}
