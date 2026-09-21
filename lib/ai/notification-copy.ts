import type { AiFeature } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — WHAT A NOTIFICATION SAYS, DECIDED ONCE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "Create a centralized notification-copy system so
 * notifications remain consistent… Premium, Modern, Minimal, Confident, Useful,
 * Not childish, Not overly promotional."
 *
 * ── 🔴 WHY A MODULE AND NOT THREE STRING LITERALS ───────────────────────────
 *
 * The same completion is announced in three places, on three different
 * surfaces, by code that never meets:
 *
 *   · the web push, from the worker (lib/ai/notify.ts);
 *   · the in-app banner, in the browser (features/ai/ai-job-alert.tsx);
 *   · the notification centre row, from the stored `notifications` record.
 *
 * Written separately, those drift within a week — and the drift is invisible,
 * because no two of them are ever on screen together. A member gets "Your video
 * is ready" on the lock screen and something subtly different in the app, and
 * the product feels assembled rather than made.
 *
 * ── 🔴 IT IS ALSO WHERE THE POLICY LIVES ────────────────────────────────────
 *
 * Two rules are load-bearing and both are easy to break one edit at a time:
 *
 *   1. NEVER a provider's words. Not a model name, not a Replicate error, not
 *      an ffmpeg dump, not an HTTP status. A member reads a sentence somebody
 *      wrote for them, always. `lib/ai/errors.ts` is the only vocabulary that
 *      qualifies, and even that is mapped rather than passed through.
 *   2. NEVER a claim about a refund we did not make. The failure copy says the
 *      allowance was not used, and that is only true because every failure
 *      that is ours releases the reservation (lib/ai/usage.ts). If that ever
 *      stops being true, this copy is a lie in somebody's pocket.
 *
 * Pure and dependency-free, so the wording can be tested without a push
 * service, a database or a browser.
 */

/** Which sentence a finished job gets. */
export type AiNotificationOutcome =
  | "completed"
  /** Genuinely broken — ours, or the provider's. The allowance came back. */
  | "failed"
  /** The member's file was not something the tool takes. Different advice. */
  | "unsupported";

export interface AiNotificationCopy {
  title: string;
  body: string;
  /**
   * What a lock screen shows when the member has "hide push preview" on.
   *
   * 🔴 Still says WHICH product finished. A generic "You have a notification"
   * is the setting working correctly and the member learning nothing — the
   * point of that toggle is to hide the CONTENT, and "your video" is not the
   * content, it is the category.
   */
  genericBody: string;
  /** Collapse key: a second one replaces the first rather than stacking. */
  tag: string;
}

/**
 * ── 🔴 ONE SPARKLE, AND ONLY ON THE GOOD NEWS ───────────────────────────────
 *
 * The brief asks for "✨ Frenz AI is ready" and, in the same breath, "Do not
 * overuse emojis. Keep the visual language premium." Those settle each other:
 * exactly one glyph, on the one notification a member is pleased to receive,
 * and none on a failure — a sparkle over bad news reads as sarcasm.
 *
 * It is also the mark this product already uses for Frenz AI everywhere else,
 * so on a crowded lock screen it is recognisable at a glance rather than
 * decorative.
 */
const SPARKLE = "✨";

/**
 * The copy for one outcome.
 *
 * `durationMs` shapes the completion sentence and nothing else. A job that took
 * four minutes is one the member almost certainly walked away from, so it is
 * told "whenever you are" rather than "tap to view" — the second is an
 * instruction to somebody who is already there, and by construction they are
 * not.
 */
export function aiNotificationCopy(input: {
  feature: AiFeature;
  outcome: AiNotificationOutcome;
  durationMs?: number | null;
  /**
   * Character Replace (Part 5, §16): whether the refund has ACTUALLY landed on
   * the ledger. "Your balance has been refunded" is written only when true;
   * otherwise the sentence says the refund is being processed. Never claimed
   * from a status alone.
   */
  refunded?: boolean | null;
  /** Part 11 §24: the job was a complimentary creation and it came back (from the audit row, never a status). */
  freeRestored?: boolean;
}): AiNotificationCopy {
  const noun = mediaNoun(input.feature);
  /*
    ── Character Replace has its own sentences (owner, Part 5 §16) ─────────
    "Your video is ready ✨ / Your Character Replace video has finished
    processing. Tap to view it." and "Character Replace couldn't finish /
    Something went wrong while processing your video. Your balance has been
    refunded." — the last clause only once the ledger says so.
  */
  if (input.feature === "ai_character_replace") {
    if (input.outcome === "completed") {
      return {
        title: `Your video is ready ${SPARKLE}`,
        body: "Your Character Replace video has finished processing. Tap to view it.",
        genericBody: "Your Frenz AI video is ready.",
        tag: "frenz-ai-done",
      };
    }
    const money =
      input.freeRestored === true
        ? "Your complimentary creation has been restored."
        : input.refunded === true
        ? "Your balance has been refunded."
        : input.refunded === false
          ? "Your balance refund is being processed."
          : "You weren't charged for it.";
    return {
      title: "Character Replace couldn't finish",
      body:
        input.outcome === "unsupported"
          ? `We couldn't work with that file. ${money} Try another video or photo.`
          : `Something went wrong while processing your video. ${money}`,
      genericBody: "A Frenz AI job needs your attention.",
      tag: "frenz-ai-failed",
    };
  }

  if (input.outcome === "completed") {
    /*
      Four minutes. Below it, somebody plausibly waited and the notification is
      an invitation; above it they left, and the notification is a note they
      will find later. The two sentences are not interchangeable.
    */
    const long = (input.durationMs ?? 0) > 4 * 60_000;
    return long
      ? {
          title: "Frenz AI finished processing",
          body: "Your result is ready whenever you are.",
          genericBody: "Your Frenz AI result is ready.",
          tag: "frenz-ai-done",
        }
      : {
          title: `${SPARKLE} Frenz AI is ready`,
          body: `Your ${noun} is finished. Tap to view your result.`,
          genericBody: "Your Frenz AI result is ready.",
          tag: "frenz-ai-done",
        };
  }

  if (input.outcome === "unsupported") {
    /*
      🔴 A DIFFERENT SENTENCE, BECAUSE THE ADVICE IS DIFFERENT. "Something went
      wrong, tap to try again" sends somebody to re-upload the identical file
      that will fail identically. When the input is the problem, the useful
      thing to say is: try a different one.
    */
    return {
      title: "Frenz AI couldn't process this file",
      body: `Try another ${noun} and give it another go.`,
      genericBody: "A Frenz AI job needs your attention.",
      tag: "frenz-ai-failed",
    };
  }

  return {
    title: "Frenz AI couldn't finish",
    /*
      🔴 "wasn't used" is a factual claim about the member's allowance, and it
      is true: every failure on our side releases the reservation before this
      is sent (lib/ai/usage.ts). Somebody who reads only "it failed" assumes it
      cost them one of their runs, and on this product it did not. Saying so is
      the difference between a bad minute and a lost customer.
    */
    /*
      Since 2026-09-13 the only tool is paid from the balance, and the charge
      is refunded on every failure path (lib/ai/funding.ts) — so "you weren't
      charged" is as true now as "your allowance wasn't used" was before.
    */
    body: "Something went wrong while processing your file. You weren't charged — tap to try again.",
    genericBody: "A Frenz AI job needs your attention.",
    tag: "frenz-ai-failed",
  };
}

/**
 * What the member calls the thing they gave us.
 *
 * A `Record` over the feature union rather than a written-out list, so a new
 * AI tool fails the BUILD here instead of shipping a notification that calls
 * somebody's photo a video.
 */
const MEDIA_NOUN: Record<AiFeature, string> = {
  ai_clean: "video",
  ai_character_replace: "video",
  ai_lip_sync: "video",
  /*
    🔴 THE COMPILER FOUND THESE, WHICH IS WHY THE RECORD IS TOTAL. The first
    draft of this file listed `ai_clean` alone and typechecked as an object
    literal; declaring it `Record<AiFeature, string>` failed the build with the
    other five named. Written as a lookup with a fallback, every one of them
    would have shipped a notification calling somebody's photo a "file".

    None of these tools are built yet (see the roadmap), so the nouns are the
    ones the brief itself uses — "Your image has finished processing" — and they
    are here now so the day one ships is not the day somebody remembers this
    file exists.
  */
  ai_image_clean: "image",
  ai_upscale: "image",
  ai_caption: "video",
  ai_background_remove: "image",
  ai_generate: "image",
};

function mediaNoun(feature: AiFeature): string {
  return MEDIA_NOUN[feature] ?? "file";
}

/**
 * Which outcome an error code represents.
 *
 * ── 🔴 THE DEFAULT IS "failed", NOT "unsupported" ───────────────────────────
 *
 * Telling somebody their file is the problem when it was ours is worse than
 * the reverse: they change a file that was fine, it fails again, and the tool
 * has now blamed them twice. So a code has to be explicitly about the INPUT to
 * get the input sentence, and everything unrecognised is ours.
 */
export function outcomeForErrorCode(code: string | null | undefined): AiNotificationOutcome {
  switch (code) {
    case "UNSUPPORTED_FORMAT":
    case "UNSUPPORTED_SOURCE":
    case "FILE_TOO_LARGE":
    case "VIDEO_TOO_LONG":
    case "INVALID_INPUT":
    case "AUDIO_INVALID":
    case "AUDIO_TOO_LONG":
    case "AUDIO_TOO_SHORT":
      return "unsupported";
    default:
      return "failed";
  }
}
