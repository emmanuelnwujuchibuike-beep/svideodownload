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
      return f.maxWidth ? `Your file is larger than ${f.maxWidth} × ${f.maxHeight} px. Please export it smaller.` : "Your file's dimensions are too large.";
    case "wrong_shape":
      return f.width ? `Your file is ${f.width} × ${f.height} px, which is the wrong shape for this format. Use the recommended size.` : "Your file is the wrong shape for this format.";
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
    case "payment_not_started":
      return "Payment could not be started. Your campaign has not been charged.";
    default:
      return "Something went wrong on our side. Please try again.";
  }
}
