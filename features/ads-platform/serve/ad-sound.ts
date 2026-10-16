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
/*
  Owner, 2026-10-16: "no sound should play when is not turned on, all video ads stay mute in default, and no
  sounds should play in background". Sound starts OFF for every video ad. Before this it started on, so the
  moment a person had touched the page (which is when browsers allow audio) every ad played aloud — a History
  grid tile behind the viewer included. It turns on only when the person taps an ad's speaker, and stays
  their choice for the session.
*/
let soundOn = false;
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
    () => false,
  );
}
