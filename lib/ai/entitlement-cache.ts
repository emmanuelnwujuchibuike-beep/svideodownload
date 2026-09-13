import type { AiMemberEntitlement } from "@/lib/ai/client";

/**
 * The last entitlement this browser saw, for the first paint.
 *
 * Owner, 2026-09-13, with the Frenz AI page on screen: "This section reloads
 * every time I enter the page or backswipe to the AI pages." The allowance
 * bar and the plan chip render NOTHING until `/api/ai/entitlement` answers,
 * then appear — so every entry, and every back-swipe, replayed the same
 * arrival. The balance card solved this on the same day with a snapshot
 * (lib/ai/balance-cache.ts); this is the same shape for the entitlement.
 *
 * 🔴 A first-paint convenience, never an authority. The network answer
 * replaces it on every mount, /start re-resolves everything server-side, and
 * it is cleared on sign-out beside the balance snapshot so one member's plan
 * chip can never greet the next.
 */

const KEY = "frenzsave_ai_entitlement_v1";
const TTL_MS = 24 * 60 * 60 * 1000;

interface Snapshot {
  at: number;
  value: AiMemberEntitlement;
}

export function readAiEntitlementCache(): AiMemberEntitlement | null {
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

export function writeAiEntitlementCache(value: AiMemberEntitlement): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: Snapshot = { at: Date.now(), value };
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode, quota — the next visit simply fetches first */
  }
}

export function clearAiEntitlementCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
