/**
 * Asks for a lazy chunk again before giving up (owner, 2026-10-30: "it enters but then reload even if the video is already
 * loaded and playing … sometimes the spinner load gets stuck on the first entry to reels").
 *
 * The Reels deck opens, plays, then lazily loads its sheets and overlays a moment later. iOS often drops the first
 * requests after the app comes back from the background (features/app-shell/chunk-error.ts), and a chunk that failed
 * once reached the error screen, which RELOADS the page — the dark screen in the middle of a playing reel. A failed
 * webpack chunk is forgotten, so asking again really fetches it again: after `delayMs`, then twice that, it usually
 * arrives. A chunk that is truly gone (a deploy replaced it) fails every try and still reaches the error screen, whose
 * reload is the only cure for that case.
 */
export function importWithRetry<T>(load: () => Promise<T>, retries = 2, delayMs = 400): Promise<T> {
  return load().catch((error: unknown) => {
    if (retries <= 0) throw error;
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        importWithRetry(load, retries - 1, delayMs * 2).then(resolve, reject);
      }, delayMs);
    });
  });
}
