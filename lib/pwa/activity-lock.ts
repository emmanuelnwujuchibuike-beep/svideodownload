/**
 * Ref-counted "don't reload out from under me" flag for workflows where an
 * unexpected page reload would destroy in-flight work: an upload actually
 * moving bytes (lib/storage/client-upload.ts), and a download's fetch+blob
 * transfer (features/downloads/manager.ts) — both run in-page, not handed
 * off to the browser's own download manager, so a reload mid-transfer would
 * silently drop them with no way to resume.
 *
 * register-sw.tsx's auto-reload-on-new-deploy checks this and, if held,
 * defers rather than skipping — it just waits for the current critical
 * section to end instead of reloading mid-upload/mid-download.
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
