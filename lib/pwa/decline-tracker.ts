/**
 * Persistent (localStorage, NOT sessionStorage) decline counter for install /
 * notification prompts — once a person explicitly dismisses the same prompt
 * this many times on a device, it stops asking for good on that device. Only
 * clearing browser storage/history resets it, matching the owner spec.
 */

const KEY_PREFIX = "frenz:decline:";
export const MAX_DECLINES = 5;

export function recordDecline(id: string): number {
  try {
    const key = KEY_PREFIX + id;
    const next = Math.min(MAX_DECLINES, (Number(localStorage.getItem(key)) || 0) + 1);
    localStorage.setItem(key, String(next));
    return next;
  } catch {
    return 0;
  }
}

export function hasExceededDeclines(id: string, max = MAX_DECLINES): boolean {
  try {
    return (Number(localStorage.getItem(KEY_PREFIX + id)) || 0) >= max;
  } catch {
    return false;
  }
}
