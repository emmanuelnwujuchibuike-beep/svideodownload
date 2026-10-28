/**
 * Frenz Gift Coin Part 6 (0296) — the rules a batch gift's quantity and note follow, shared by the sheet and the server
 * (client-safe, no I/O). The database applies the same rules again in send_gift_batch: these exist so the member sees
 * the refusal before sending, and so the server refuses a bad request before it reaches the database.
 *
 *   quantity   a whole number from 1 to GIFT_BATCH_MAX. Ten: a chat gesture, not a bulk tool, and it bounds how long
 *              both wallets stay locked in one transaction. The value cap is the administrator's daily limit.
 *   note       optional. Trimmed at both ends; blank (or only spaces) = no note. At most GIFT_NOTE_MAX characters,
 *              counted as Postgres counts them (code points, so an emoji is one). No control characters — the field is
 *              one line, and a newline or a hidden control code is refused rather than silently changed.
 */
export const GIFT_BATCH_MAX = 10;
export const GIFT_NOTE_MAX = 200;

export function isGiftQuantity(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= GIFT_BATCH_MAX;
}

export const noteLength = (s: string) => [...s].length;

// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export type NoteCheck = { ok: true; note: string | null } | { ok: false; reason: "note_too_long" | "note_invalid" };

/** The note as it will be stored, or why it can't be. */
export function normalizeGiftNote(raw: unknown): NoteCheck {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== "string") return { ok: false, reason: "note_invalid" };
  const t = raw.trim();
  if (!t) return { ok: true, note: null };
  if (CONTROL.test(t)) return { ok: false, reason: "note_invalid" };
  if (noteLength(t) > GIFT_NOTE_MAX) return { ok: false, reason: "note_too_long" };
  return { ok: true, note: t };
}

/** The total the member is shown before confirming (the server and database compute their own). */
export const giftTotal = (priceFgc: number, quantity: number) => priceFgc * quantity;
