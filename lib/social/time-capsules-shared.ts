/** A capsule seals for at least this long — a "capsule" that unlocks in two
 *  minutes isn't meaningfully sealed. Enforced on create, both here (for any
 *  future server-side caller) and in the API route. */
export const MIN_SEAL_MS = 60 * 60 * 1000; // 1 hour
export const TITLE_MAX = 80;
export const MESSAGE_MAX = 2000;

export interface TimeCapsule {
  id: string;
  title: string;
  /** Null while `locked` — the message NEVER reaches the client before
   *  `unlockAt`, regardless of how this is queried through the app. */
  message: string | null;
  unlockAt: string;
  createdAt: string;
  locked: boolean;
}

