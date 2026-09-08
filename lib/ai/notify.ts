import "server-only";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — telling somebody their video is ready, because they left
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 WHY THIS IS NOT OPTIONAL POLISH ───────────────────────────────────────
 *
 * Measured 2026-09-08: the model AI Clean calls is published on CPU hardware,
 * and a 1.5 MB clip ran for 41 minutes before the owner gave up and cancelled
 * it. Even once it is republished on GPU (docs/replicate-gpu/) the honest
 * expectation is minutes, not seconds.
 *
 * Nobody watches a progress bar for ten minutes on a phone. They switch apps,
 * the tab sleeps, and the polling stops — so the result lands somewhere they
 * are not looking, and the feature reads as broken even when it worked
 * perfectly. A push is the only thing that closes that gap, and this site has
 * had web push working for months, so it is wiring rather than new
 * infrastructure.
 *
 * ── Reuses `processing_finished`, which already existed ──────────────────────
 *
 * Not a new notification type. `lib/platform/notifications-registry.ts` already
 * carries `processing_finished` ("Processing finished") and `download_failed`
 * under the `downloads` category — the same mental model as a finished
 * download, and already respected by every per-category preference, the Do Not
 * Disturb rule and the quiet-hours logic. A bespoke `ai_clean_done` type would
 * have meant a registry entry, a settings row and a fresh set of preferences
 * that nobody asked for, to say the same sentence.
 *
 * ── Never throws ─────────────────────────────────────────────────────────────
 *
 * A job that genuinely finished must never be reported as failed because a
 * notification did not send. Every call here is best-effort and swallows its
 * own errors — the job row is the source of truth, this is a courtesy on top.
 * And it is now safe to call inline: the push fan-out is bounded (see the
 * timeout block in lib/push/web-push.ts), which it was not before 2026-09-08,
 * when one stale device could hold a route open until the platform killed it.
 */

/** Where the member lands when they tap. Straight back to the workspace. */
const AI_CLEAN_URL = `${SITE_URL}/studio/ai/clean`;

export async function notifyAiCleanFinished(opts: {
  userId: string;
  jobId: string;
  /** False when the source had no audio — still a success, just worth saying. */
  audioRestored?: boolean | null;
}): Promise<void> {
  try {
    await sendSmartPush(
      opts.userId,
      {
        title: "Your video is ready",
        body: "AI Clean finished removing the text. Tap to download it.",
        url: `${AI_CLEAN_URL}?job=${encodeURIComponent(opts.jobId)}`,
        // Collapse key: a second finished job replaces the first rather than
        // stacking two identical-looking notifications on the lock screen.
        tag: "ai-clean-done",
      },
      // Not "critical" — that tier outranks Do Not Disturb and is reserved for
      // security. A finished video is worth a lock screen, not worth overriding
      // somebody who asked not to be disturbed.
      "high",
      "downloads",
      { type: "processing_finished" },
    );
  } catch (e) {
    console.error("[ai/notify] finished push failed", { jobId: opts.jobId, error: String(e) });
  }
}

export async function notifyAiCleanFailed(opts: {
  userId: string;
  jobId: string;
  /**
   * What the MEMBER may read. Never a provider string, never an ffmpeg dump —
   * callers pass a sentence from lib/ai/errors.ts, which is the only vocabulary
   * that has been written for a person.
   */
  message: string;
}): Promise<void> {
  try {
    await sendSmartPush(
      opts.userId,
      {
        title: "AI Clean didn't finish",
        // 🔴 The refund is IN the notification. A member who reads "it failed"
        // and nothing else assumes it cost them one of two daily runs, and on
        // this product it did not — every failure that is ours releases the
        // reservation (see lib/ai/usage.ts). Saying so is the difference
        // between a bad minute and a lost customer.
        body: opts.message,
        url: AI_CLEAN_URL,
        tag: "ai-clean-failed",
      },
      "high",
      "downloads",
      { type: "download_failed" },
    );
  } catch (e) {
    console.error("[ai/notify] failed push failed", { jobId: opts.jobId, error: String(e) });
  }
}
