"use client";

import type { PresenceStatus } from "@/lib/social/presence-status";

/**
 * Client-side cache + pub-sub for the VIEWER'S OWN presence status — shared
 * between `PresenceStatusPicker` (the UI) and `use-presence.ts` (which needs
 * to know live whether to track/untrack itself on the shared online channel
 * when the status flips to/from "invisible"), so both stay in sync without
 * each re-fetching independently or one having to import the other.
 */

let current: PresenceStatus = "available";
let loaded = false;
let loadingPromise: Promise<PresenceStatus> | null = null;
const listeners = new Set<(status: PresenceStatus) => void>();

function emit(): void {
  for (const l of listeners) l(current);
}

export function subscribeMyPresenceStatus(listener: (status: PresenceStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedMyPresenceStatus(): PresenceStatus {
  return current;
}

/** Fetches the real value from the server once; cheap to call repeatedly. */
export async function ensureMyPresenceStatusLoaded(userId: string): Promise<PresenceStatus> {
  if (loaded) return current;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const res = await fetch(`/api/presence-status?ids=${userId}`);
      if (res.ok) {
        const json = await res.json();
        const s = json?.statuses?.[userId] as PresenceStatus | undefined;
        if (s) current = s;
      }
    } catch {
      /* stays "available" (the default) on failure */
    } finally {
      loaded = true;
      loadingPromise = null;
      emit();
    }
    return current;
  })();
  return loadingPromise;
}

/** Optimistic local set — call right after a successful (or in-flight) PATCH. */
export function setMyPresenceStatusLocal(status: PresenceStatus): void {
  current = status;
  loaded = true;
  emit();
}
