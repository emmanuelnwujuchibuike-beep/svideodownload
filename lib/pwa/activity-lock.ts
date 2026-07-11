/**
 * Ref-counted "don't reload out from under me" flag for the small set of
 * workflows where an unexpected page reload would destroy in-flight work —
 * today, only an upload actually moving bytes (lib/storage/client-upload.ts).
 * A downloaded FILE is not this: `downloadToDisk` hands off to the browser's
 * own native download manager, which keeps running independently of the page
 * (the whole reason it's used on iOS), so a reload can't interrupt it.
 *
 * register-sw.tsx's auto-reload-on-new-deploy checks this and, if held,
 * defers rather than skipping — it just waits for the current critical
 * section to end instead of reloading mid-upload.
 */
let count = 0;
const listeners = new Set<() => void>();

/** Call at the start of a critical section; call the returned function when it ends. */
export function beginCriticalActivity(): () => void {
  count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) listeners.forEach((fn) => fn());
  };
}

export function isCriticalActivityInProgress(): boolean {
  return count > 0;
}

/** Fires once, the next time the lock count returns to zero. */
export function onCriticalActivityIdle(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
