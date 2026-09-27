/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LAST ANSWER EACH AI PAGE SAW, KEPT ON THE DEVICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "back swipe to go back in the Ai pages, text to audio,
 * voice cloning and all pages, they reload on everytime, they don't cache so
 * back swipe and return in the all the Ai pages never reload or load after
 * first load, users can revalidate only by swiping down from the top."
 *
 * ── 🔴 WHY THE ROUTER CACHE WAS NOT THE PROBLEM ─────────────────────────────
 *
 * `next.config` already sets `staleTimes: { dynamic: 21600 }` — six hours — so
 * going back does NOT refetch the server component. What reloaded was the
 * CLIENT: React unmounts a route's component tree on navigation, so every
 * `useEffect(() => void load(), [])` in an AI workspace ran again on the way
 * back, emptied its state to a skeleton, and paid for the round trip. The
 * router cache cannot help with that; only remembering the answer can.
 *
 * ── The shape, and why it is not the balance cache ──────────────────────────
 *
 * `lib/ai/balance-cache.ts` and `lib/ai/history-cache.ts` are the same idea for
 * one endpoint each, and they paint-then-revalidate: the snapshot is a first
 * frame, the network still runs. That was right for a dashboard figure that
 * moves on its own.
 *
 * This one is keyed, so every AI page can use it, and the revalidation is the
 * MEMBER'S to ask for — `useCachedView` only refetches when the snapshot is
 * missing, when it is older than the caller's freshness window, or when
 * something explicitly asks. Pull-to-refresh is what asks.
 *
 * ── 🔴 NEVER TRUSTED FOR A DECISION ─────────────────────────────────────────
 *
 * Exactly like the two caches above: a snapshot decides nothing. What a
 * generation costs, whether a member can afford it, whether a voice slot is
 * free — all of that is the server's, recomputed at the moment it matters, and
 * every one of these endpoints already refuses on its own terms. This only
 * stops a page opening empty.
 *
 * A day's TTL and `clearAiViewCache()` on sign-out bound the shared-device
 * case, because these answers are a member's own.
 */

const PREFIX = "frenzsave_ai_view_v1:";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface AiViewSnapshot<T> {
  /** When the answer was received, so a caller can decide it is too old. */
  at: number;
  value: T;
}

function keyFor(name: string): string {
  return `${PREFIX}${name}`;
}

export function readAiViewCache<T>(name: string): AiViewSnapshot<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AiViewSnapshot<T>>;
    if (typeof parsed.at !== "number" || parsed.value === undefined) return null;
    if (Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(keyFor(name));
      return null;
    }
    return { at: parsed.at, value: parsed.value as T };
  } catch {
    return null;
  }
}

export function writeAiViewCache<T>(name: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(name), JSON.stringify({ at: Date.now(), value } satisfies AiViewSnapshot<T>));
  } catch {
    /* quota, private mode — the next open pays the network again, and nothing worse */
  }
}

export function dropAiViewCache(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(name));
  } catch {
    /* the TTL is the backstop */
  }
}

/**
 * Called on sign-out. Every AI snapshot belongs to the session that read it,
 * so they all go — one prefix, one sweep, no list to keep in step.
 */
export function clearAiViewCache(): void {
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) window.localStorage.removeItem(k);
  } catch {
    /* nothing to do — the TTL is the backstop */
  }
}

/**
 * The event a pull-to-refresh fires, and the only thing that makes a cached AI
 * page go back to the network by itself.
 *
 * A plain window event rather than a context: the pages that listen are lazy
 * route chunks mounted far from `PageRefresh`, and threading a provider through
 * every AI layout to deliver one boolean would be more moving parts than the
 * thing it delivers.
 */
export const AI_REFRESH_EVENT = "frenz:ai-refresh";

export function requestAiRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_REFRESH_EVENT));
}
