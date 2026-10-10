import type { FriendRequestItem } from "@/lib/social/friends";

/**
 * The friend request card's pure logic (Feature 19 · Part 2) — kept apart from
 * the components so it is unit-tested directly (features/friends/request-card.test.ts).
 */
export const ACCEPT_AS: readonly { key: string; label: string }[] = [
  { key: "close_friend", label: "Close friend" },
  { key: "family", label: "Family" },
  { key: "colleague", label: "Colleague" },
  { key: "classmate", label: "Classmate" },
  { key: "business_partner", label: "Business partner" },
];

const SOURCE_LABEL: Record<string, string> = {
  profile: "from your profile",
  search: "found you in search",
  suggestion: "from suggestions",
  qr: "scanned your QR code",
  nearby: "nearby",
  link: "from your profile link",
  messages: "from Messages",
};

export function requestContextLine(req: FriendRequestItem, now: number = Date.now()): string[] {
  const c = req.context;
  const parts: string[] = [];
  if (c?.mutualFriends) parts.push(`${c.mutualFriends} mutual friend${c.mutualFriends === 1 ? "" : "s"}`);
  if (c?.memberSince) {
    const since = new Date(c.memberSince);
    const days = (now - since.getTime()) / 86_400_000;
    parts.push(days < 30 ? "New to Frenz" : `On Frenz since ${since.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`);
  }
  if (c?.source && SOURCE_LABEL[c.source]) parts.push(SOURCE_LABEL[c.source]!);
  return parts;
}

/** Request filters (Feature 19 · Part 2): sorting and narrowing the incoming list, all on data already loaded. */
export type RequestFilter = "newest" | "oldest" | "mutual" | "verified";
export const REQUEST_FILTERS: { id: RequestFilter; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "mutual", label: "Most mutual" },
  { id: "verified", label: "Verified" },
];
export function filterRequests(list: FriendRequestItem[], f: RequestFilter): FriendRequestItem[] {
  const byDate = (a: FriendRequestItem, b: FriendRequestItem) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (f === "oldest") return [...list].sort((a, b) => byDate(b, a));
  if (f === "mutual") return [...list].sort((a, b) => (b.context?.mutualFriends ?? 0) - (a.context?.mutualFriends ?? 0) || byDate(a, b));
  if (f === "verified") return list.filter((r) => r.user.isVerified).sort(byDate);
  return [...list].sort(byDate);
}
