/**
 * Smart Circle suggestions (Feature 19 · Part 4 — "Smart Circle AI" and
 * "Automatic Organization", built as transparent rules).
 *
 * Every suggestion is computed from facts the member ALREADY has about their
 * own relationships — the strength band, their own favourites, their own private
 * labels — and says which one it used. Nothing reads the other person's
 * behaviour, nothing is applied automatically: a suggestion is a button the
 * member may press. Pure, so the rules are the tests.
 */
import { CIRCLE_KINDS, type CircleKind } from "./circles";

export interface SuggestionConnection {
  id: string;
  band: string;
  favorite: boolean;
  label: string | null;
  circleIds: readonly string[];
}

export interface SuggestionCircle {
  id: string;
  name: string;
  kind: string;
}

export interface CircleSuggestion {
  key: string;
  /** a special circle, or a custom circle by name */
  target: { kind: CircleKind } | { name: string };
  title: string;
  reason: string;
  memberIds: string[];
}

const CLOSE_LABELS = new Set(["best_friend", "close_friend", "partner"]);
const VIP_LABELS = new Set(["colleague", "mentor", "client", "business_partner"]);
/** A suggestion for one or two people is noise; a circle is a group. */
export const MIN_SUGGESTION_MEMBERS = 2;

export function circleSuggestions(connections: readonly SuggestionConnection[], circles: readonly SuggestionCircle[]): CircleSuggestion[] {
  const byKind = (k: CircleKind) => circles.find((c) => c.kind === k);
  const byName = (n: string) => circles.find((c) => c.name.toLowerCase() === n.toLowerCase());
  const notIn = (circleId: string | undefined) => (c: SuggestionConnection) => !circleId || !c.circleIds.includes(circleId);
  const out: CircleSuggestion[] = [];

  const close = byKind("close_friends");
  const closeIds = connections.filter(notIn(close?.id)).filter((c) => c.band === "close" || c.favorite || (c.label && CLOSE_LABELS.has(c.label))).map((c) => c.id);
  if (closeIds.length >= MIN_SUGGESTION_MEMBERS) {
    out.push({
      key: "close_friends",
      target: { kind: "close_friends" },
      title: `Add ${closeIds.length} to ${CIRCLE_KINDS.close_friends.name}`,
      reason: "Your favourites, the people you label close, and the friends you talk to most.",
      memberIds: closeIds,
    });
  }

  const family = byName("Family");
  const familyIds = connections.filter(notIn(family?.id)).filter((c) => c.label === "family").map((c) => c.id);
  if (familyIds.length >= MIN_SUGGESTION_MEMBERS) {
    out.push({ key: "family", target: { name: "Family" }, title: `Add ${familyIds.length} to Family`, reason: "You labelled them family.", memberIds: familyIds });
  }

  const vip = byKind("vip");
  const vipIds = connections.filter(notIn(vip?.id)).filter((c) => c.label && VIP_LABELS.has(c.label)).map((c) => c.id);
  if (vipIds.length >= MIN_SUGGESTION_MEMBERS) {
    out.push({
      key: "vip",
      target: { kind: "vip" },
      title: `Add ${vipIds.length} to ${CIRCLE_KINDS.vip.name}`,
      reason: "You labelled them as colleagues, mentors, clients or partners.",
      memberIds: vipIds,
    });
  }
  return out;
}
