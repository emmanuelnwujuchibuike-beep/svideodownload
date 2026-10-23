"use client";

import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";

/**
 * ONE sound preference for every feed and reel video (owner, 2026-10-23: "the videos are always on mute
 * and always had to be unmuted on every video scroll … if not it defaults to play sound on landing and
 * scrolling, only if manually muted").
 *
 * - Default: SOUND ON. It goes off only when the member taps mute, and that choice is remembered (this
 *   device, across visits) and applies to every video until they tap unmute again.
 * - A browser may refuse sound before the visitor has touched the page (every browser's autoplay
 *   rule). Then the clip plays muted for now, and the FIRST tap anywhere turns the sound on — the member
 *   never has to find the button, and never has to do it again on the next video.
 * - ⚠️ A website cannot read the phone's silent switch or ringer volume: no browser exposes it. The
 *   device's own media volume still applies as always.
 *
 * Supersedes the feed's "always autoplay muted" rule (lib/media/audio-playback.ts): sound now takes
 * audio focus when a clip plays, which pauses other apps' music — the owner's call.
 */

const KEY = "frenz.sound.muted";
const CHANGE = "frenz:sound-change";
const UNLOCK = "frenz:sound-unlock";

/** Did the member mute on purpose? (Storage failing — private mode — reads as "no": sound on.) */
export function userMutedSound(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** The member tapped mute/unmute: remembered, and every mounted video follows. */
export function setUserMutedSound(muted: boolean): void {
  try {
    if (muted) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* not persisted; this page still follows */
  }
  window.dispatchEvent(new CustomEvent(CHANGE, { detail: { muted } }));
}

/** Follow the member's choice made on any video. Returns the unsubscribe. */
export function onSoundPreference(fn: (muted: boolean) => void): () => void {
  const h = (e: Event) => fn(!!(e as CustomEvent<{ muted: boolean }>).detail?.muted);
  window.addEventListener(CHANGE, h);
  return () => window.removeEventListener(CHANGE, h);
}

/** The browser just allowed sound (the first tap after a refusal). Returns the unsubscribe. */
export function onSoundUnlocked(fn: () => void): () => void {
  window.addEventListener(UNLOCK, fn);
  return () => window.removeEventListener(UNLOCK, fn);
}

let unlockArmed = false;
/** After a refusal: the next real gesture anywhere on the page unlocks sound for the playing clip. */
function armUnlock(): void {
  if (unlockArmed) return;
  unlockArmed = true;
  const fire = () => {
    unlockArmed = false;
    for (const t of ["pointerdown", "keydown", "touchend"] as const) window.removeEventListener(t, fire, true);
    if (!userMutedSound()) window.dispatchEvent(new Event(UNLOCK));
  };
  for (const t of ["pointerdown", "keydown", "touchend"] as const) window.addEventListener(t, fire, true);
}

/**
 * Start (or resume) a clip the way the member wants it: with sound unless they muted. If the browser
 * refuses sound, it plays muted and the next tap anywhere brings the sound in. Resolves to what it did.
 */
export async function playWithPreferredSound(v: HTMLMediaElement): Promise<"sound" | "muted" | "failed"> {
  if (userMutedSound()) {
    if (!v.muted) muteInstant(v);
    return v.play().then(
      () => "muted" as const,
      () => "failed" as const,
    );
  }
  v.muted = false;
  if (v.volume === 0) v.volume = 1;
  try {
    await v.play();
    return "sound";
  } catch {
    // autoplay with sound refused → muted for now; the first tap turns it on
    v.muted = true;
    armUnlock();
    return v.play().then(
      () => "muted" as const,
      () => "failed" as const,
    );
  }
}

/** Bring the sound in on a playing clip (a tap unlocked it, or the member chose sound). */
export function soundOn(v: HTMLMediaElement): void {
  if (v.muted) unmuteWithFade(v);
}
