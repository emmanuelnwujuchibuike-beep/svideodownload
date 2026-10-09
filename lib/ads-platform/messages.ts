import { formatBytes } from "./offer";

/**
 * Every refusal an advertiser can meet, in plain words with the real numbers.
 * The server sends a CODE (and the facts it measured), the browser renders it
 * through here — so the text and the numbers can never disagree, and no
 * internal error ever reaches the screen.
 */

export interface MessageFacts {
  durationSeconds?: number | null;
  maxDurationSeconds?: number | null;
  fileSizeBytes?: number | null;
  maxFileBytes?: number | null;
  width?: number | null;
  height?: number | null;
  minWidth?: number | null;
  minHeight?: number | null;
  maxWidth?: number | null;
  maxHeight?: number | null;
  mediaType?: string | null;
  reason?: string | null;
}

const secs = (s: number) => `${Math.round(s * 10) / 10} seconds`;

export function adMessage(code: string, f: MessageFacts = {}): string {
  switch (code) {
    case "video_too_long":
      return f.durationSeconds && f.maxDurationSeconds
        ? `That video is ${secs(f.durationSeconds)} long. The current maximum is ${f.maxDurationSeconds} seconds.`
        : "That video is longer than this format allows.";
    case "file_too_large":
      return f.mediaType === "video"
        ? `Your video is larger than the allowed file size${f.maxFileBytes ? ` (${formatBytes(f.maxFileBytes)})` : ""}.`
        : `Your image is larger than the allowed file size${f.maxFileBytes ? ` (${formatBytes(f.maxFileBytes)})` : ""}.`;
    case "dimensions_too_small":
      return f.width && f.minWidth && f.minHeight
        ? `Your file is ${f.width} × ${f.height} px. It needs to be at least ${f.minWidth} × ${f.minHeight} px.`
        : "Your file is too small for this format.";
    case "dimensions_too_large":
      return f.maxWidth
        ? `Your file is larger than ${Math.max(f.maxWidth, f.maxHeight ?? 0)} px on its longest side, which is more than we can safely process. Export it at ${Math.max(f.maxWidth, f.maxHeight ?? 0)} px or smaller and upload again.`
        : "Your file's dimensions are too large to process safely.";
    // 0208: no longer produced — a creative is never refused for its shape; kept for old rows
    case "wrong_shape":
      return "Your file's shape differs from the slot. It will be shown whole, with space around it.";
    case "decode_too_large":
      return "That image claims more pixels than we can safely open. Export it at a normal size (for example 4000 px on the longest side) and try again.";
    case "optimize_failed":
      return "We couldn't optimize that image in your browser. Try exporting it as JPG or PNG and upload again.";
    case "processing_unavailable":
    case "video_needs_processing":
      return "This video is larger than we serve and can't be optimized right now. Please try again in a few minutes, or export it at 1280 px and under the size limit.";
    case "processing_failed":
      return "We couldn't optimize that video. Export it again as MP4 (H.264) and upload it.";
    case "processing_timeout":
      return "Optimizing that video took too long. Please upload it again, or export a smaller MP4.";
    case "creative_checking":
      return "Your creative is still being checked. Give it a few seconds and try again.";
    case "processing_cancelled":
      return "That video was replaced before it finished optimizing.";
    case "media_type_not_allowed":
      return f.mediaType === "image" ? "This format takes a video, not an image." : "This format takes an image, not a video.";
    case "mime_not_allowed":
    case "not_recognised":
      return "That file type isn't supported. Use JPG, PNG, WebP or AVIF for images, and MP4 or WebM for video.";
    case "quicktime":
      return "That's a MOV (QuickTime) video. Please export or share it as MP4 and upload again.";
    case "duration_unknown":
      return "We couldn't read the length of that video. Please export it again as MP4.";
    case "dimensions_unknown":
    case "size_unknown":
      return "We couldn't read that file. Please export it again and upload.";
    case "upload_missing":
      return "The upload didn't finish. Please try again.";
    case "destination_not_valid":
    case "url_invalid":
      return "Please enter a valid destination URL, starting with https://";
    case "destination_blocked":
      return f.reason === "link shortener"
        ? "Please use your full website address. Shortened links hide where people will go, so they aren't accepted."
        : "That destination can't be used for advertising on Frenzsave.";
    // Part 8 (0206): the deeper link and content checks
    case "destination_unsafe":
      return "That destination didn't pass our safety checks, so it can't be used for advertising on Frenzsave. Please link to your own website directly.";
    case "needs_review":
      return "That link needs a quick check by our team before it can go live. Your current ad keeps running unchanged — contact support if you need it sooner.";
    case "content_rejected":
      return "This ad didn't pass our content safety checks. Please read the Advertising Rules and try a different image, video or wording.";
    case "content_needs_review":
      return "This change needs a quick check by our team before it can go live. Your current ad keeps running unchanged.";
    case "type_mismatch":
      return "That file isn't what its name says it is. Please export it again and upload.";
    case "format_unavailable":
      return "This ad format is currently unavailable.";
    case "placement_unavailable":
    case "placement_disabled":
      return "This placement is no longer available. Please choose another.";
    case "duration_unavailable":
    case "duration_disabled":
      return "This campaign duration is no longer available. Please choose another.";
    case "no_price":
      return "This option isn't for sale right now. Please choose another.";
    case "too_many_placements":
      return "You've chosen more placements than one campaign can take.";
    case "rules_not_accepted":
      return "Please read and agree to the Frenzsave Advertising Rules.";
    case "rules_outdated":
      return "The Advertising Rules have been updated. Please read and agree to the new version.";
    case "applications_closed":
      return "Advertising applications open soon. Your ad is saved as a draft.";
    case "advertiser_not_active":
      return "Your advertiser account can't create new campaigns right now. Please contact support.";
    case "too_many_drafts":
      return "You have too many unfinished ads. Please finish or discard one first.";
    case "details_missing":
      return "Please add a campaign name and your business or brand name.";
    case "no_creative":
      return "Please upload your image or video first.";
    case "creative_not_valid":
      return "Your image or video didn't pass the checks. Please upload a new one.";
    case "not_found":
      return "We couldn't find that ad. It may have been discarded.";
    case "not_editable":
      return "This ad can no longer be changed.";
    case "sign_in":
      return "Please sign in to continue.";
    case "rate_limited":
      return "You're going a little fast. Please wait a moment and try again.";
    case "payments_disabled":
    case "payments_unavailable":
      return "Advertising payments are temporarily unavailable. Please try again later.";
    case "quote_expired":
      return "Your price has expired. Please review your ad again to get a fresh price.";
    case "quote_invalid":
    case "not_payable":
      return "This price is no longer valid. Please review your ad again to get a fresh price.";
    case "payment_in_progress":
      return "A payment for this ad is already in progress. Please finish it, or wait a moment and check its status.";
    case "payment_not_found":
      return "We couldn't find that payment.";
    case "payment_not_started":
      return "Payment could not be started. Your campaign has not been charged.";
    /* ── Part 6: managing a paid campaign ── */
    case "stale":
      return "This campaign changed in another tab or window. We've reloaded it — please make your change again.";
    case "campaign_ended":
    case "expired":
      return "This campaign has ended. Create a new campaign to run this ad again.";
    case "blocked":
      return "This ad was stopped by Frenzsave, so it can't be edited. Please contact support.";
    case "edit_not_allowed":
      return "This change isn't available for running campaigns right now.";
    case "control_not_allowed":
      return "Pausing and resuming isn't available right now.";
    case "extension_not_allowed":
      return "Extending campaigns isn't available right now.";
    case "not_extendable":
      return "Only a running or paused campaign that hasn't ended can be extended.";
    case "payment_open":
      return "A payment for this campaign is already in progress. Finish or cancel it first.";
    case "not_live":
      return "Only a live campaign can be paused.";
    case "not_paused":
      return "This campaign isn't paused.";
    case "paused_by_frenzsave":
      return "Frenzsave paused this campaign, so only our team can resume it. Please contact support.";
    case "resume_flagged":
      return "Your campaign couldn't go live again yet — it needs a quick check. We'll let you know as soon as it's live.";
    case "not_ready":
    case "format_mismatch":
      return "The new file didn't pass the checks, so your current ad stays live.";
    case "nothing_to_change":
      return "Nothing changed.";
    default:
      return "Something went wrong on our side. Please try again.";
  }
}
