import "server-only";

import { claimAiNotification } from "@/lib/ai/job-store";
import { aiNotificationCopy, outcomeForErrorCode } from "@/lib/ai/notification-copy";
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
  /** Shapes the sentence: a job somebody waited out reads differently. */
  durationMs?: number | null;
}): Promise<void> {
  /*
    🔴 THE CLAIM COMES FIRST. Four call sites can announce one job (the
    finalizer, reconcile, the stall sweep) and a webhook can be delivered twice.
    `claimAiNotification` is a conditional UPDATE on `notified_at`, so exactly
    one of them wins and every later one returns here without sending.
  */
  if (!(await claimAiNotification(opts.jobId))) return;

  const copy = aiNotificationCopy({
    feature: "ai_clean",
    outcome: "completed",
    durationMs: opts.durationMs ?? null,
  });

  try {
    await sendSmartPush(
      opts.userId,
      {
        title: copy.title,
        body: copy.body,
        /*
          🔴 Straight to the RESULT, not the homepage. The id is carried in the
          url and re-authorised server-side when the page asks for the file —
          nothing here grants access, it only says which job to open. See
          `/api/ai/jobs/[id]/result` for the ownership check that actually
          decides.
        */
        url: `${AI_CLEAN_URL}?job=${encodeURIComponent(opts.jobId)}`,
        // What a lock screen shows when "hide push preview" is on. Still names
        // the product: that toggle hides the content, and "your result" is the
        // category rather than the content.
        genericBody: copy.genericBody,
        // Collapse key: a second finished job replaces the first rather than
        // stacking two identical-looking notifications on the lock screen.
        tag: copy.tag,
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
   *
   * ⚠️ No longer sent as the push body. See below.
   */
  message: string;
  /**
   * The stable code, so the copy can tell "your file" apart from "our fault".
   * Optional because three of the four callers predate it; absent means ours,
   * which is the safer default — see `outcomeForErrorCode`.
   */
  errorCode?: string | null;
}): Promise<void> {
  // One announcement per job, whichever safety net gets there first.
  if (!(await claimAiNotification(opts.jobId))) return;

  /*
    ── 🔴 THE COPY, NOT THE CALLER'S MESSAGE ──────────────────────────────────

    This used to push `opts.message` verbatim. Every caller passes a sentence
    from lib/ai/errors.ts, so it was never a provider string — but it was a
    sentence written for a PANEL, where the member is already looking at the
    job and its context. On a lock screen, with no context, "We couldn't finish
    this video. Your allowance wasn't used — please try again shortly." is a
    paragraph.

    The centralised copy is written for the lock screen, and it says the two
    things that actually matter there: it failed, and it cost you nothing. The
    caller's fuller sentence still shows in the panel, where there is room.

    `errorCode` picks between "something went wrong" and "try another file",
    because sending somebody back to re-upload the identical file that will
    fail identically is worse than saying nothing.
  */
  const copy = aiNotificationCopy({
    feature: "ai_clean",
    outcome: outcomeForErrorCode(opts.errorCode),
  });

  try {
    await sendSmartPush(
      opts.userId,
      {
        title: copy.title,
        body: copy.body,
        genericBody: copy.genericBody,
        url: AI_CLEAN_URL,
        tag: copy.tag,
      },
      "high",
      "downloads",
      { type: "download_failed" },
    );
  } catch (e) {
    console.error("[ai/notify] failed push failed", { jobId: opts.jobId, error: String(e) });
  }
}
