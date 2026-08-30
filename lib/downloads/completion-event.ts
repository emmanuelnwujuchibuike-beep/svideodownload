/**
 * The window event fired when a download actually finishes.
 *
 * ── Why an event rather than `onDownloadCompleted()` ──────────────────────────
 *
 * The download manager already has a perfectly good subscription API. But it is
 * a 900-line `"use client"` module that pulls in analytics, the history store,
 * IndexedDB media storage, the toast system and the save-to-device helpers —
 * so *importing* it is the expensive part, not listening to it.
 *
 * The post-download ad has to be armed on EVERY page (owner, 2026-08-30:
 * "landing pages and download, history and all pages"), which means mounting
 * its trigger in the root layout's `DeferredShell`. Importing the manager there
 * would put all of that on every single page's bundle and straight through the
 * 1.6s / 275 KiB landing budget.
 *
 * This is the same trade `lib/monetization/monetag-events.ts` already documents
 * for the same reason: one dependency-free constant, so the listener costs
 * nothing and only the DISPATCHER — the manager, which is by definition already
 * loaded whenever a download is running — carries the weight.
 */
export const DOWNLOAD_COMPLETED_EVENT = "frenz:download:completed";
