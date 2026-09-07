/**
 * The event the download manager fires when a transfer is refused for space.
 *
 * Owner, 2026-09-07: "Make sure free users who exceed their 5gb storage limit
 * will not be able to save media, any download should show storage full free
 * storage or upgrade to pro."
 *
 * ── Why an event, and why its own file ────────────────────────────────────────
 *
 * The refusal happens in `features/downloads/manager.ts`, a plain module with no
 * way to render a dialog. The gate that has to appear is a React overlay mounted
 * once in the app shell. An event is the seam between them.
 *
 * It lives alone, dependency-free, for the same reason
 * `lib/downloads/completion-event.ts` does: the listener is mounted on EVERY
 * page, and importing the manager to learn one string would drag the history
 * store, IndexedDB media, analytics and the toast system onto every route —
 * straight through the landing page's 1.6s budget. Only the DISPATCHER pays for
 * the manager, and it is loaded already by definition.
 */
export const STORAGE_FULL_EVENT = "frenz:downloads:storage-full";

/** What the gate needs in order to say how full, and offer the right way out. */
export interface StorageFullDetail {
  usedBytes: number;
  /** How many stored items that is — the "clear history" side of the choice. */
  count: number;
  limitBytes: number;
}
