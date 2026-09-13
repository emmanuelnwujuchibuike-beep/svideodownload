/**
 * The last dashboard the member saw, kept on the device so the next open
 * paints it before the network answers.
 *
 * ── Owner, 2026-09-13 ───────────────────────────────────────────────────────
 *
 * "The balance doesn't load when the page opens; there should be a strip
 * loading that shows loading dashboard when the page opens, and the dashboard
 * should load more faster."
 *
 * The row rendered NOTHING until `/api/ai/balance` answered — a hole on the
 * page for the length of a Supabase auth check, a rate-limit round-trip and
 * six reads. This is the same answer the AI history already has
 * (lib/ai/history-cache.ts): paint the last known snapshot on the first frame,
 * revalidate immediately, replace. A returning member sees their balance at
 * once; the strip is only for a first-ever open on this device.
 *
 * ── What is stored ─────────────────────────────────────────────────────────
 *
 * Exactly the JSON the endpoint returned: a balance, counters, prices, and a
 * few ledger lines with amounts and kinds. No payment references, no ids
 * that mean anything outside this account — `/api/ai/balance` is already an
 * allow-list. A day's TTL and `clearAiBalanceCache` on sign-out bound the
 * shared-device case, exactly as the history cache does.
 *
 * ── Never trusted for anything but paint ───────────────────────────────────
 *
 * The dashboard's decisions (can this member afford a video, what does a
 * recharge cost) are the server's, made on the server, at the moment they
 * matter. This snapshot decides nothing; it only stops the page opening empty.
 */

const KEY = "frenzsave_ai_balance_v1";
const TTL_MS = 24 * 60 * 60 * 1000;

interface Snapshot<T> {
  at: number;
  value: T;
}

export function readAiBalanceCache<T>(): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Snapshot<T>>;
    if (typeof parsed.at !== "number" || parsed.value === undefined) return null;
    if (Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed.value as T;
  } catch {
    return null;
  }
}

export function writeAiBalanceCache<T>(value: T): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: Snapshot<T> = { at: Date.now(), value };
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* quota, private mode — the next open pays the network again, no more */
  }
}

/** Called on sign-out. A balance must not outlive the session that read it. */
export function clearAiBalanceCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do — the TTL is the backstop */
  }
}
