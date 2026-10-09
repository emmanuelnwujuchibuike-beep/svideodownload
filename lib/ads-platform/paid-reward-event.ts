/**
 * The download reward gates' question to the paid-ad layer (0203). Its own module,
 * NOT moment-events.ts: that one is imported by the network triggers on every page,
 * and this is needed only by the reward gate (download pages) and the paid moments.
 */
/*
  0203 (owner, 2026-10-09: "check if reward ads for high quality and batch
  downloads were added to the promote formats, and they should use the same ad
  pattern already set on the ad network"). The reward GATE (useRewardFlow) asks
  the paid layer first with one synchronous event. If the paid layer is loaded,
  a campaign is live for the placement and it leads the slot's provider order,
  it takes the gate and plays the sponsor's reward video. A full watch completes
  the SAME server-checked reward session the network ad would. Otherwise nothing
  answers and the network ad runs exactly as before.
*/
export const PAID_REWARD_EVENT = "frenz:paid-reward";

export type PaidRewardPlacement = "hd_download_reward" | "batch_download_reward";

export interface PaidRewardRequest {
  placement: PaidRewardPlacement;
  /** the video was watched to the end */
  onComplete: () => void;
  /** closed before the end */
  onDismiss: () => void;
  /** set by the paid layer when it takes the gate */
  handled: boolean;
}

/** true when a paid reward video took the gate; false → run the network ad. */
export function requestPaidReward(placement: PaidRewardPlacement, onComplete: () => void, onDismiss: () => void): boolean {
  if (typeof window === "undefined") return false;
  const detail: PaidRewardRequest = { placement, onComplete, onDismiss, handled: false };
  window.dispatchEvent(new CustomEvent<PaidRewardRequest>(PAID_REWARD_EVENT, { detail }));
  return detail.handled;
}
