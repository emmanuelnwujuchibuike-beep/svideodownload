"use client";

import { useSyncExternalStore } from "react";

/**
 * Ad sound, one choice for the session (owner, 2026-10-10: "let video ads play
 * their audio, but users should be able to mute the audio").
 *
 * A video ad tries to play WITH sound. Browsers (iOS above all) refuse sound
 * until the person has interacted with the page — then it plays muted and the
 * speaker button reads "Tap for sound". Muting one ad mutes them all for the
 * rest of the session; unmuting does the same. Nothing is stored past the tab.
 */
let soundOn = true;
const listeners = new Set<() => void>();

export function adSoundOn(): boolean {
  return soundOn;
}

export function setAdSound(on: boolean): void {
  soundOn = on;
  for (const l of listeners) l();
}

export function useAdSound(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => soundOn,
    () => true,
  );
}
