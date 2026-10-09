/**
 * Window events the paid-ad layer listens for (Part 5). Strings only, so the
 * code that fires them — the AI save path — imports nothing of the ad engine.
 */

/** An AI video save has STARTED. The save never waits on anything that hears this. */
export const AI_VIDEO_SAVE_EVENT = "frenz:ai:video-save";

/*
  A full-screen MOMENT (a finished download, a saved AI video, a return to the
  tab) gets at most ONE ad. A paid campaign claims the moment; the network
  unit answering the same moment checks `momentClaimed` and stands down.
  Here, not in the engine, because the network triggers are on every page and
  must import only this. Claims expire, so a claim can never silence the
  network for good.
*/
export type AdMoment = "download-complete" | "return";

const claims: Partial<Record<AdMoment, number>> = {};

export const MOMENT_CLAIM_MS = 60_000;

export function claimMoment(moment: AdMoment, now: number = Date.now()): void {
  claims[moment] = now;
}

export function momentClaimed(moment: AdMoment, now: number = Date.now()): boolean {
  const at = claims[moment];
  return at !== undefined && now - at < MOMENT_CLAIM_MS;
}

/** Tests only. */
export function __resetMomentClaims(): void {
  for (const k of Object.keys(claims)) delete claims[k as AdMoment];
}

