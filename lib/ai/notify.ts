import "server-only";

import { freeUseState } from "@/lib/ai/character-replace/free-access";
import { characterReplaceRefundState } from "@/lib/ai/character-replace/wallet";
import { recordJobEvent } from "@/lib/ai/job-events";
import { claimAiNotification, getJobAsService, noteJobDiagnostic } from "@/lib/ai/job-store";
import { dispatchAiNotification } from "@/lib/ai/notify-dispatch";
import { hasWebPush } from "@/lib/push/web-push";
import type { AiFeature } from "@/lib/ai/jobs";
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
/**
 * Where a tap on the push lands: the tool's workspace, which adopts `?job=`
 * whatever its status (the member was sent to LOOK at that job). One URL per
 * feature, so an old AI Clean row — still announced by the safety nets until
 * retention expires it — opens history rather than a workspace that no longer
 * exists.
 */
/**
 * ── 🔴 SEND FROM WHERE THE KEYS ARE (2026-09-14) ─────────────────────────────
 *
 * Two Character Replace jobs completed on the worker this morning and no push
 * went out: the worker has no VAPID keys, `sendPushToUser` returned before
 * logging anything, and the claim had already been taken — so nothing could
 * ever send it. The in-app notice was written (the owner saw "your video is
 * ready" only on opening the app).
 *
 * So: a process without push keys does NOT claim. It hands the job to the
 * frontend (`/api/internal/ai/notify`, worker-secret) and, if that fails,
 * records `notify_pending` on the row; the member's next poll (Vercel) sees
 * the flag and sends — still exactly once, because the claim is the same
 * conditional UPDATE. `local: true` is the frontend route itself, which must
 * never re-dispatch.
 */
async function handOffIfNoKeys(jobId: string, local: boolean | undefined): Promise<boolean> {
  if (hasWebPush || local) return false;
  const handed = await dispatchAiNotification(jobId);
  if (!handed.dispatched) {
    await noteJobDiagnostic(jobId, { notify_pending: true, notify_detail: handed.detail.slice(0, 200) });
    await recordJobEvent(jobId, "notify.pending", { detail: handed.detail.slice(0, 200) });
    console.warn("[ai/notify] no push keys here and the hand-off failed — left pending", { jobId, detail: handed.detail });
  } else {
    await recordJobEvent(jobId, "notify.handed_off", {});
  }
  return true;
}

/**
 * Announce a job from its ROW — completed → finished, failed/cancelled →
 * failed. Used by the frontend's internal notify route (the worker's
 * hand-off) and by the member-poll fallback for a row left `notify_pending`.
 * Idempotent through the claim; a job that is not terminal sends nothing.
 */
export async function notifyAiJobFromRow(jobId: string, opts: { local: boolean }): Promise<"sent" | "skipped" | "not-terminal"> {
  const job = await getJobAsService(jobId);
  if (!job || !job.user_id) return "skipped";
  if (job.status === "completed") {
    await notifyAiJobFinished({ userId: job.user_id, jobId: job.id, feature: job.feature, audioRestored: job.audio_restored, durationMs: null, local: opts.local });
    return "sent";
  }
  if (job.status === "failed" || job.status === "cancelled" || job.status === "expired") {
    await notifyAiJobFailed({ userId: job.user_id, jobId: job.id, feature: job.feature, message: "", errorCode: job.error_code, local: opts.local });
    return "sent";
  }
  return "not-terminal";
}

function workspaceUrlFor(feature: string, jobId: string): string {
  const q = `?job=${encodeURIComponent(jobId)}`;
  /*
    Part 7 §23–§24: the push opens the RESULT route for this exact job. The
    page checks ownership on the server before it renders anything, sends a
    signed-out member through sign-in and back, and carries no media URL —
    only the job's id, which is worthless to anyone but its owner.
  */
  if (feature === "ai_character_replace") return `${SITE_URL}/studio/ai/character-replace/result/${encodeURIComponent(jobId)}`;
  return `${SITE_URL}/studio/ai/history${q}`;
}

export async function notifyAiJobFinished(opts: {
  userId: string;
  jobId: string;
  /** Which tool made it. Absent means the current tool. */
  feature?: AiFeature;
  /** False when the source had no audio — still a success, just worth saying. */
  audioRestored?: boolean | null;
  /** Shapes the sentence: a job somebody waited out reads differently. */
  durationMs?: number | null;
  /** True only inside /api/internal/ai/notify — the process that holds the keys. */
  local?: boolean;
}): Promise<void> {
  if (await handOffIfNoKeys(opts.jobId, opts.local)) return;
  /*
    🔴 THE CLAIM COMES FIRST. Four call sites can announce one job (the
    finalizer, reconcile, the stall sweep) and a webhook can be delivered twice.
    `claimAiNotification` is a conditional UPDATE on `notified_at`, so exactly
    one of them wins and every later one returns here without sending.
  */
  if (!(await claimAiNotification(opts.jobId))) {
    await recordJobEvent(opts.jobId, "notify.skipped", { outcome: "completed", reason: "already claimed" });
    return;
  }

  const copy = aiNotificationCopy({
    feature: opts.feature ?? "ai_character_replace",
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
        url: workspaceUrlFor(opts.feature ?? "ai_character_replace", opts.jobId),
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
    await recordJobEvent(opts.jobId, "notify.sent", { outcome: "completed", dedupeKey: `character_replace_completed:${opts.jobId}` });
  } catch (e) {
    // A push that fails never fails the job: the result is stored and visible in history (§20).
    console.error("[ai/notify] finished push failed", { jobId: opts.jobId, error: String(e) });
    await recordJobEvent(opts.jobId, "notify.skipped", { outcome: "completed", reason: "send threw", error: String(e).slice(0, 160) });
  }
}

export async function notifyAiJobFailed(opts: {
  userId: string;
  jobId: string;
  feature?: AiFeature;
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
  local?: boolean;
}): Promise<void> {
  if (await handOffIfNoKeys(opts.jobId, opts.local)) return;
  // One announcement per job, whichever safety net gets there first.
  if (!(await claimAiNotification(opts.jobId))) {
    await recordJobEvent(opts.jobId, "notify.skipped", { outcome: "failed", reason: "already claimed" });
    return;
  }
  // Character Replace: "refunded" only when the ledger says so (Part 5, §16).
  const refunded =
    (opts.feature ?? "ai_character_replace") === "ai_character_replace" ? await characterReplaceRefundState(opts.userId, opts.jobId) : null;

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
  // Part 11 §24: a complimentary creation that came back says so — read from its audit row, never assumed.
  const freeRestored = (opts.feature ?? "ai_character_replace") === "ai_character_replace" && refunded === "none" ? (await freeUseState(opts.jobId)) === "restored" : false;
  const copy = aiNotificationCopy({
    feature: opts.feature ?? "ai_character_replace",
    outcome: outcomeForErrorCode(opts.errorCode),
    refunded: refunded === "refunded" ? true : refunded === "pending" ? false : null,
    freeRestored,
  });

  try {
    await sendSmartPush(
      opts.userId,
      {
        title: copy.title,
        body: copy.body,
        genericBody: copy.genericBody,
        url: workspaceUrlFor(opts.feature ?? "ai_character_replace", opts.jobId),
        tag: copy.tag,
      },
      "high",
      "downloads",
      { type: "download_failed" },
    );
    await recordJobEvent(opts.jobId, "notify.sent", { outcome: "failed", refunded, dedupeKey: `character_replace_failed:${opts.jobId}` });
  } catch (e) {
    // A push that fails never fails the refund — the ledger moved before this ran (§20).
    console.error("[ai/notify] failed push failed", { jobId: opts.jobId, error: String(e) });
    await recordJobEvent(opts.jobId, "notify.skipped", { outcome: "failed", reason: "send threw", error: String(e).slice(0, 160) });
  }
}
