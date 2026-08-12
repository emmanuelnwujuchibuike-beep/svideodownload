/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REELS SESSION — a different deck every time you open it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief (2026-08-11): "make reels always refresh each opens and never
 * show one video twice every open, it should reshuffle every open."
 *
 * ── Why opening /reels used to hand back the identical deck ────────────────
 *
 * Three separate reasons, and fixing only one of them changes nothing:
 *
 *   1. `getHomeFeed` reshuffles ONLY when it is given a seed, and the reels
 *      page never passed one. Every render ranked by the same scores in the
 *      same order.
 *   2. Even with a seed, the page is reached from the tab bar, and Next's
 *      Router Cache REUSES the RSC payload for a cached route. The server
 *      component does not re-run, so a server-minted seed is minted once and
 *      then replayed on every subsequent open — the deck is frozen at whatever
 *      the first entry produced. This is the one that makes it feel broken.
 *   3. Nothing anywhere remembered what had already been watched, so even a
 *      genuine reshuffle re-served the same top clips in a new order.
 *
 * This module owns (2) and (3). The server owns (1).
 *
 * ── The ledger is deliberately client-side ─────────────────────────────────
 *
 * "What I have already seen" is per-device and worth nothing to anyone else; it
 * changes on every single reel; and it must be readable synchronously at mount,
 * before the first paint, or the deck flashes the old arrangement before
 * settling into the new one. A table would give up all three to gain durability
 * across devices that nobody asked for.
 *
 * ── Exhaustion is the case that matters ────────────────────────────────────
 *
 * 🔴 "Never show the same video twice" and "always have something to show" are
 * in direct conflict on a catalogue this size. A filter that is allowed to
 * empty the deck turns a young platform's reels tab into a permanent empty
 * state — a far worse bug than a repeat. So the rule everywhere here is: the
 * ledger is a PREFERENCE, applied only while enough unseen reels remain, and
 * abandoned (and reset) the moment it would starve the deck. Suppression —
 * "not interested" — is different and is always absolute: it is an instruction,
 * not a preference.
 */

/** Reshuffle token. Same alphabet the API route sanitises to, so it survives
 *  the round-trip intact. */
export function newReelsSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Watched ids, newest last. Capped — see `WATCHED_CAP`. */
const WATCHED_KEY = "frenz:reels:watched";
/** Explicit "not interested" / "hide this post". Never expires. */
const SUPPRESSED_KEY = "frenz:reels:suppressed";

/*
  How much history to keep.

  Long enough that a normal viewing session never laps itself, short enough that
  the ledger cannot outgrow the catalogue and put the deck permanently into the
  exhaustion fallback below. 200 reels is roughly an hour of watching.
*/
const WATCHED_CAP = 200;
const SUPPRESSED_CAP = 500;

/*
  How many ids travel to the server on a page-0 request.

  They ride in the query string, so this is a URL-length budget, not a taste
  question: 80 UUIDs is about 3KB, comfortably inside every proxy in the path.
  The rest of the ledger still applies CLIENT-side, where there is no limit — so
  the cap costs nothing except that the server may hand back an item the client
  then filters itself.
*/
export const EXCLUDE_LIMIT = 80;

/** Below this many usable reels, the watched filter is abandoned. */
export const MIN_DECK = 4;

function readList(key: string): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Untrusted: this is localStorage, which an older build may have written
    // differently and a person can edit. A bad shape means "no history", never
    // a throw on a hot mount path.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

function writeList(key: string, ids: string[], cap: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(ids.slice(-cap)));
  } catch {
    /* private mode / quota — the ledger just does not outlive the session */
  }
}

/** Every watched id this device remembers, oldest first. */
export function watchedReels(): string[] {
  return readList(WATCHED_KEY);
}

/** The most recent ids, in the shape the API's `exclude` param takes. */
export function watchedForRequest(limit = EXCLUDE_LIMIT): string[] {
  const all = readList(WATCHED_KEY);
  return all.slice(-limit);
}

/**
 * Record that a reel was actually shown.
 *
 * Re-watching moves an id to the newest end rather than adding a duplicate, so
 * the cap always evicts the genuinely oldest thing and the ledger cannot fill
 * with one reel someone scrubbed back and forth.
 */
export function markReelWatched(id: string): void {
  if (!id) return;
  const list = readList(WATCHED_KEY).filter((v) => v !== id);
  list.push(id);
  writeList(WATCHED_KEY, list, WATCHED_CAP);
}

export function clearWatchedReels(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(WATCHED_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Ids the viewer explicitly asked not to see again. */
export function suppressedReels(): string[] {
  return readList(SUPPRESSED_KEY);
}

export function suppressReel(id: string): void {
  if (!id) return;
  const list = readList(SUPPRESSED_KEY).filter((v) => v !== id);
  list.push(id);
  writeList(SUPPRESSED_KEY, list, SUPPRESSED_CAP);
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Deterministic (seed, id) → [0,1). FNV-1a, byte for byte the same function
 * `home-feed.ts` ranks with.
 *
 * Duplicated rather than imported ON PURPOSE: `home-feed.ts` is a server module
 * that reaches for the Supabase admin client at import time, and pulling it into
 * the reels client bundle to borrow eight lines of arithmetic would ship the
 * whole feed loader — and its service-role import path — to the browser.
 */
function seededUnit(seed: string, id: string): number {
  const s = `${seed}:${id}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Reorder a deck for this open.
 *
 * A pure order shuffle, NOT the server's score jitter: by the time items reach
 * the client the ranking has already happened, and re-applying a score model
 * here without the scores would just be a second, worse ranker. What this
 * guarantees is only that two opens with different seeds see different
 * arrangements of the same items, deterministically.
 */
export function shuffleWithSeed<T extends { id: string }>(items: T[], seed: string): T[] {
  return items
    .map((item) => ({ item, k: seededUnit(seed, item.id) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.item);
}

export interface FreshDeckResult<T> {
  items: T[];
  /**
   * True when the watched filter had to be abandoned to keep the deck alive.
   * The caller resets the ledger on this, so the next open starts clean rather
   * than being stuck in the fallback forever.
   */
  exhausted: boolean;
}

/**
 * The deck for one open: suppressed removed, watched removed if affordable,
 * reshuffled.
 *
 * Pure and exported so the rule can be tested directly — the exhaustion branch
 * is the one that decides between "a repeated reel" and "an empty screen", and
 * that is not a thing to leave to a manual check.
 */
export function freshDeck<T extends { id: string }>(
  items: T[],
  opts: {
    seed: string;
    watched: Iterable<string>;
    suppressed: Iterable<string>;
    min?: number;
    /**
     * Reorder, or only filter?
     *
     * False when the SERVER already arranged this open — its ranking knows the
     * engagement scores and the freshness window, and re-sorting that by a hash
     * here would throw away a real ranking for an arbitrary one. In that case
     * the only thing left to do is remove what this device has already seen,
     * which is the half the server cannot do.
     */
    shuffle?: boolean;
  },
): FreshDeckResult<T> {
  const min = opts.min ?? MIN_DECK;
  const suppressed = new Set(opts.suppressed);
  const watched = new Set(opts.watched);

  // Absolute: an explicit "not interested" is an instruction, and is honoured
  // even if it leaves nothing at all.
  const allowed = items.filter((i) => !suppressed.has(i.id));

  const unseen = allowed.filter((i) => !watched.has(i.id));
  // The whole point of the fallback: prefer unseen, but never trade the deck
  // for the principle.
  const exhausted = unseen.length < min && allowed.length > unseen.length;
  const chosen = exhausted ? allowed : unseen;

  return {
    items: opts.shuffle === false ? chosen : shuffleWithSeed(chosen, opts.seed),
    exhausted,
  };
}
