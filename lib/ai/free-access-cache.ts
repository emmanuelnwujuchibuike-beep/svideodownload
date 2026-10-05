import type { CharacterReplaceFreeAccess } from "@/lib/ai/character-replace/types";

/**
 * The last complimentary-creations line this browser saw, for the first paint.
 *
 * ── 🔴 THE SAME REPORT, THE THIRD TIME (owner, 2026-10-05) ──────────────────
 *
 * "This complimentary card reloads all the time on back swipe and every page
 * entry — it should only load once."
 *
 * On 2026-09-13 the owner said, of the same screen: "This section reloads
 * every time I enter the page or backswipe to the AI pages." That was answered
 * twice — `lib/ai/balance-cache.ts` for the balance card, then
 * `lib/ai/entitlement-cache.ts` for the allowance bar and plan chip, both
 * snapshots seeded on mount.
 *
 * The complimentary pill was missed. `frenz-ai-explore.tsx` already seeds its
 * config from `readCachedConfig()` and its entitlement from
 * `readAiEntitlementCache()`, and then reads the free-access block out of a
 * LIVE balance call with nothing behind it — so that one element, alone on the
 * page, rendered nothing until the network answered and then popped in. Every
 * entry, every back-swipe.
 *
 * 🔴 It is a first-paint convenience and never an authority, exactly like its
 * two siblings: the network answer replaces it on every mount, `/start`
 * re-resolves eligibility server-side before anything is spent, and it is
 * cleared on sign-out beside the other two so one member's remaining count can
 * never greet the next.
 *
 * ⚠️ Which is also why the count is allowed to be briefly stale rather than
 * withheld: showing last-known and correcting it silently is what stops the
 * flash, and nothing is decided from this value. A creation spent in this tab
 * writes the new count through `writeAiFreeAccessCache` as soon as the balance
 * is re-read.
 */

const KEY = "frenzsave_ai_free_access_v1";
const TTL_MS = 24 * 60 * 60 * 1000;

interface Snapshot {
  at: number;
  value: CharacterReplaceFreeAccess;
}

export function readAiFreeAccessCache(): CharacterReplaceFreeAccess | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    if (typeof parsed.at !== "number" || !parsed.value || typeof parsed.value !== "object") return null;
    if (Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeAiFreeAccessCache(value: CharacterReplaceFreeAccess): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: Snapshot = { at: Date.now(), value };
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode, quota — the next visit simply fetches first */
  }
}

export function clearAiFreeAccessCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
