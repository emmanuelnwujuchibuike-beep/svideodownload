/**
 * The Exclusive feed's ORDER (owner, 2026-10-31: "the exclusive feed should behave like the main feed page in reshuffle so
 * it doesn't always start with a particular person post … when a user made a new post it shows at the top as new but
 * blurred to unsubscriber … resume from where user stop, never show a particular video first each time a user enter the
 * app and exclusive feed"; "drag down should be able to reshuffle the exclusive feed").
 *
 *   · NEW first: what was posted since the viewer's last visit (at most a week back; the last day when the visit is
 *     unknown), newest first, at most NEW_MAX — a creator's fresh post is the first thing seen, once;
 *   · then everything else SHUFFLED by the visit's seed — the same seed gives the same order (the next pages, a return
 *     to the tab), a new visit or a pull-down gives a new one;
 *   · never the same creator twice in a row while another is waiting.
 * Shared by the subscribed posts and the blurred discover cards (lib/sub/feed.ts). Pure.
 */
export const NEW_WINDOW_MS = 7 * 24 * 3600 * 1000;
export const NEW_UNKNOWN_MS = 24 * 3600 * 1000;
export const NEW_MAX = 10;

export interface Orderable {
  id: string;
  creatorId: string;
  createdAt: string;
}

/** FNV-1a (32-bit) of seed + id: a stable shuffle position — the same seed always gives the same order. */
export function seededRank(seed: string, id: string): number {
  let h = 0x811c9dc5;
  const s = `${seed}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A seed from the outside (a URL), or null: letters, digits, _ and -, at most 32. */
export function cleanSeed(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) : "";
  return s || null;
}

export function newSeed(): string {
  // randomUUID needs a secure context and a recent browser; any random string orders just as well
  const uuid = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return uuid.replace(/-/g, "").slice(0, 16);
}

/** Never the same creator twice in a row while someone else's item is waiting (greedy, keeps the order otherwise). */
export function spreadCreators<T extends Orderable>(items: T[]): T[] {
  const queue = [...items];
  const out: T[] = [];
  while (queue.length) {
    const last = out[out.length - 1]?.creatorId;
    let i = queue.findIndex((t) => t.creatorId !== last);
    if (i === -1) i = 0;
    out.push(queue.splice(i, 1)[0]!);
  }
  return out;
}

export function exclusiveOrder<T extends Orderable>(items: T[], seed: string, sinceMs: number | null, nowMs: number = Date.now()): T[] {
  const floor = sinceMs && sinceMs > 0 ? Math.max(sinceMs, nowMs - NEW_WINDOW_MS) : nowMs - NEW_UNKNOWN_MS;
  const at = (t: T) => Date.parse(t.createdAt);
  const fresh = items
    .filter((t) => at(t) > floor && at(t) <= nowMs + 60_000)
    .sort((a, b) => at(b) - at(a))
    .slice(0, NEW_MAX);
  const pinned = new Set(fresh.map((t) => t.id));
  const rest = items.filter((t) => !pinned.has(t.id)).sort((a, b) => seededRank(seed, a.id) - seededRank(seed, b.id) || (a.id < b.id ? -1 : 1));
  return [...fresh, ...spreadCreators(rest)];
}

/** The next page of a shuffled feed: its seed, where it continues, and the visit it was ordered for. */
export function encodeShuffleCursor(seed: string, offset: number, sinceMs: number | null): string {
  return `s1.${seed}.${offset}.${sinceMs && sinceMs > 0 ? Math.round(sinceMs) : ""}`;
}

export function decodeShuffleCursor(raw: unknown): { seed: string; offset: number; sinceMs: number | null } | null {
  if (typeof raw !== "string") return null;
  const m = /^s1\.([A-Za-z0-9_-]{1,32})\.(\d{1,4})\.(\d{0,13})$/.exec(raw);
  if (!m) return null;
  return { seed: m[1]!, offset: Number(m[2]), sinceMs: m[3] ? Number(m[3]) : null };
}
