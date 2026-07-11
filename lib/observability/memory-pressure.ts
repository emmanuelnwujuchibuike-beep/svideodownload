"use client";

/**
 * Reactive memory-pressure signal — deliberately NOT a polling loop (no
 * setInterval/rAF while idle, which would be exactly the pointless battery
 * cost this whole session has avoided everywhere else). Checked only at
 * points where work is already happening: the tab going hidden (the same
 * visibilitychange lifecycle event `features/data/cache.ts`'s global
 * revalidation already listens to) is a natural, safe moment to check and,
 * if needed, prune — nothing is actively rendering, so freeing memory then
 * can't cause a visible hitch.
 *
 * `performance.memory` is Chrome/Edge/Android only (non-standard); every
 * other browser has no signal to act on, so this silently never fires there
 * — not a functional gap, since there's nothing to detect.
 */

const listeners = new Set<() => void>();
let wired = false;

interface MemoryInfo {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function readMemory(): MemoryInfo | undefined {
  return (performance as unknown as { memory?: MemoryInfo }).memory;
}

/** Pure decision logic, split out from the `performance.memory` read so
 * it's testable without a DOM — true when used heap crosses 85% of the
 * browser's heap limit for this tab. */
export function shouldFlagMemoryPressure(mem: MemoryInfo | undefined): boolean {
  if (!mem || !mem.jsHeapSizeLimit) return false;
  return mem.usedJSHeapSize / mem.jsHeapSizeLimit > 0.85;
}

export function isUnderMemoryPressure(): boolean {
  return shouldFlagMemoryPressure(readMemory());
}

export function onMemoryPressure(cb: () => void): () => void {
  listeners.add(cb);
  ensureWired();
  return () => listeners.delete(cb);
}

function ensureWired(): void {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    if (!isUnderMemoryPressure()) return;
    // Independently guarded: one listener throwing must never stop the
    // rest from running or leave the visibilitychange handler itself
    // throwing an uncaught error.
    for (const cb of listeners) {
      try {
        cb();
      } catch {
        /* a future second consumer's bug shouldn't break pruneInactive */
      }
    }
  });
}
