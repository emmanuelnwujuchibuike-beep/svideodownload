"use client";

export interface SoundPrefs {
  masterEnabled: boolean;
  messageEnabled: boolean;
  mentionEnabled: boolean;
  reactionEnabled: boolean;
  typingEnabled: boolean;
}

const DEFAULTS: SoundPrefs = {
  masterEnabled: true,
  messageEnabled: true,
  mentionEnabled: true,
  reactionEnabled: true,
  typingEnabled: true,
};

/**
 * Client-side cache + pub-sub for the viewer's in-app sound prefs — same
 * shape as presence-status-client.ts. `sound-fx.ts` reads the cache
 * synchronously on every play attempt (never awaits a fetch on the hot
 * path); `NotificationSettingsPicker` is what actually loads/mutates it.
 */
let current: SoundPrefs = DEFAULTS;
let loaded = false;
let loadingPromise: Promise<SoundPrefs> | null = null;
const listeners = new Set<(prefs: SoundPrefs) => void>();

function emit(): void {
  for (const l of listeners) l(current);
}

export function subscribeSoundPrefs(listener: (prefs: SoundPrefs) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedSoundPrefs(): SoundPrefs {
  return current;
}

export async function ensureSoundPrefsLoaded(): Promise<SoundPrefs> {
  if (loaded) return current;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const res = await fetch("/api/notification-sound-prefs");
      if (res.ok) {
        const json = await res.json();
        if (json?.prefs) current = json.prefs as SoundPrefs;
      }
    } catch {
      /* stays at defaults on failure */
    } finally {
      loaded = true;
      loadingPromise = null;
      emit();
    }
    return current;
  })();
  return loadingPromise;
}

export function setSoundPrefsLocal(patch: Partial<SoundPrefs>): void {
  current = { ...current, ...patch };
  loaded = true;
  emit();
}
