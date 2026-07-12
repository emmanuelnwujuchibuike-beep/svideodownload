"use client";

import { getCachedSoundPrefs } from "@/lib/social/notification-sound-prefs-client";

/**
 * In-app interaction sounds (Part 4 spec 4b) — short, synthesized tones via
 * the Web Audio API rather than shipped audio files. This is deliberate,
 * not a placeholder: a web app has no access to licensed sound-pack assets,
 * and a handful of clean oscillator blips with a proper attack/decay
 * envelope is a real, established technique for exactly this kind of UI
 * feedback (the same idea behind most OS "tick" sounds) — architected so a
 * future round can swap in real designed audio files per sound WITHOUT
 * changing any call site, just the synthesis inside `TONES` below.
 *
 * Foreground-only by design: this is the sound that plays while the tab is
 * open and the user is actively using the app, distinct from (and unrelated
 * to) the OS push-notification sound, which a web app cannot override on
 * either iOS or Android.
 */

type SoundType = "message" | "mention" | "reaction" | "typing" | "tap";

let ctx: AudioContext | null = null;
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

// Browser autoplay policy: an AudioContext starts "suspended" and can only be
// resumed as a DIRECT result of a genuine user gesture (click/tap/keydown) —
// a `resume()` call from inside a Realtime message handler (an incoming
// message/reaction/mention, not something the user just clicked) is not a
// user gesture and the browser silently refuses it. Since `playSound()` used
// to call `resume()` reactively, fire-and-forget, on every single play
// attempt — including the very first "message" sound for an incoming chat,
// which is almost never preceded by the recipient having typed/clicked
// anything in that tab yet — the very first sound (and every one after it,
// until SOME unrelated click happened to land on the page) never actually
// played. This one-time listener resumes the context the moment the user
// does anything at all, anywhere on the page, so it's already running by the
// time a real-time event needs to play a sound.
let unlocked = false;
function unlockOnFirstGesture(): void {
  if (typeof window === "undefined" || unlocked) return;
  unlocked = true;
  const resume = () => {
    void getContext()?.resume().catch(() => {});
  };
  const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
  for (const type of events) window.addEventListener(type, resume, { once: true, passive: true });
}
unlockOnFirstGesture();

interface Note {
  freq: number;
  at: number; // seconds from the sound's start
  duration: number; // seconds
  gain: number; // 0-1
}

const TONES: Record<SoundType, Note[]> = {
  message: [{ freq: 720, at: 0, duration: 0.11, gain: 0.11 }],
  mention: [
    { freq: 660, at: 0, duration: 0.09, gain: 0.13 },
    { freq: 990, at: 0.07, duration: 0.12, gain: 0.13 },
  ],
  reaction: [{ freq: 1180, at: 0, duration: 0.05, gain: 0.09 }],
  typing: [{ freq: 420, at: 0, duration: 0.04, gain: 0.045 }],
  // Nav tap (owner ask, 2026-07-12: "add haptic sound in webapp nav buttons")
  // — the quietest tone here by design: it fires on every bottom-nav/sidebar
  // navigation, so it must read as a soft physical "tick", never a beep.
  tap: [{ freq: 950, at: 0, duration: 0.035, gain: 0.05 }],
};

function playNote(audioCtx: AudioContext, note: Note): void {
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = note.freq;
  const start = audioCtx.currentTime + note.at;
  const end = start + note.duration;
  // Quick attack, exponential decay — avoids the click a hard on/off would
  // produce and reads as a soft, premium "blip" rather than a harsh beep.
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(note.gain, start + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(start);
  osc.stop(end + 0.01);
}

const PREF_KEY: Partial<Record<SoundType, "messageEnabled" | "mentionEnabled" | "reactionEnabled" | "typingEnabled">> = {
  message: "messageEnabled",
  mention: "mentionEnabled",
  reaction: "reactionEnabled",
  typing: "typingEnabled",
  // "tap" has no per-type preference — it rides the master switch only.
};

/** Best-effort — never throws (autoplay-blocked/unsupported browsers just stay silent). */
export function playSound(type: SoundType): void {
  try {
    const prefs = getCachedSoundPrefs();
    if (!prefs.masterEnabled) return;
    const prefKey = PREF_KEY[type];
    if (prefKey && !prefs[prefKey]) return;
    const audioCtx = getContext();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") {
      // A suspended context can only be resumed from inside a genuine user
      // gesture (see unlockOnFirstGesture above). Many playSound calls ARE
      // inside one (a nav tap, the composer's keydown) — so resume and, if
      // the resume actually succeeds, play THIS sound rather than dropping
      // it; a gesture-less trigger's resume() just rejects/never runs and
      // stays silent, same as before.
      void audioCtx
        .resume()
        .then(() => {
          if (audioCtx.state === "running") for (const note of TONES[type]) playNote(audioCtx, note);
        })
        .catch(() => {});
      return;
    }
    for (const note of TONES[type]) playNote(audioCtx, note);
  } catch {
    /* best-effort UI polish, never breaks the app */
  }
}
