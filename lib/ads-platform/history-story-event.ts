/**
 * The History viewer's question to the paid-ad layer (0243). Its own module, like
 * ./paid-reward-event.ts: the player imports only this string and function, never
 * the ad engine.
 */
/*
  Owner, 2026-10-14: "when a user watched 3 medias from history he or she should
  see the full screen ad, can be image or video. Include it to the self ad
  application and service." The player holds its advance every 3 media and asks
  the paid layer first with one synchronous event. If the paid layer is loaded, a
  campaign is live for `history_story` and it leads the slot's provider order, it
  takes the moment and calls `onDone` when its ad closes. Otherwise nothing
  answers and the network's story ad runs exactly as before.
*/
export const HISTORY_STORY_AD_EVENT = "frenz:history-story-ad";

export interface HistoryStoryAdRequest {
  /** the paid ad closed — the player completes the advance it was holding */
  onDone: () => void;
  /** set by the paid layer when it takes the moment */
  handled: boolean;
}

/** true when a paid ad took the moment; false → run the network's story ad. */
export function requestPaidHistoryStoryAd(onDone: () => void): boolean {
  if (typeof window === "undefined") return false;
  const detail: HistoryStoryAdRequest = { onDone, handled: false };
  window.dispatchEvent(new CustomEvent<HistoryStoryAdRequest>(HISTORY_STORY_AD_EVENT, { detail }));
  return detail.handled;
}
