/**
 * Frenz Gift Coin Part 6 — three small per-device conveniences, all in browser storage (never on the server: none of
 * them is a money or security decision). Every read and write is guarded: private mode, blocked storage or a preview
 * that throws simply behaves as "never set".
 *
 *   coach mark       "Send a sticker gift" tip in the composer — once dismissed (or once a gift is sent), never again
 *   ask-to-confirm   owner, 2026-10-27: "they send a gift like a normal sticker but the first gift they choose whether
 *                    to be asked if they are sure for the next 1 week". The confirmation can be skipped for 7 days.
 *                    The server never relies on it — every gift is still checked in full by the database.
 *   return to chat   the chat a top-up started from, so the Gift Box can offer "Back to the chat" after converting
 *                    (session storage: it belongs to this visit only)
 */
const COACH = "frenz:gift-coach-dismissed";
const SKIP = "frenz:gift-confirm-skip-until";
const RETURN = "frenz:gift-return";
export const CONFIRM_SKIP_MS = 7 * 24 * 60 * 60 * 1000;

function get(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function set(store: "local" | "session", key: string, value: string | null): void {
  try {
    const s = store === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* storage unavailable: the convenience just isn't remembered */
  }
}

export const coachDismissed = () => get("local", COACH) === "1";
export const dismissCoach = () => set("local", COACH, "1");

/** True while the member chose "don't ask again for a week". */
export function confirmSkipped(now = Date.now()): boolean {
  const until = Number(get("local", SKIP) ?? 0);
  return Number.isFinite(until) && until > now;
}
export const skipConfirmForAWeek = (now = Date.now()) => set("local", SKIP, String(now + CONFIRM_SKIP_MS));
export const askConfirmAgain = () => set("local", SKIP, null);

/** Only an in-app chat path is ever stored or offered — never an arbitrary URL. */
export const isChatPath = (p: unknown): p is string => typeof p === "string" && /^\/messages\/[0-9a-f-]{36}$/i.test(p);
export const rememberGiftReturn = (path: string) => {
  if (isChatPath(path)) set("session", RETURN, path);
};
export function giftReturn(): string | null {
  const p = get("session", RETURN);
  return isChatPath(p) ? p : null;
}
export const clearGiftReturn = () => set("session", RETURN, null);
