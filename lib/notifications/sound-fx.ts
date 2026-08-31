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

type SoundType = "message" | "mention" | "reaction" | "typing" | "tap" | "wow" | "streak" | "streak-milestone";

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
  /**
   * Oscillator shape. Defaults to `sine`, which every tone above this line
   * uses and which is why they all read as clean UI blips.
   *
   * `triangle` exists for the milestone's low foundation notes: a sine at
   * 261Hz at a listenable level is felt more than heard on a phone speaker,
   * which has almost no output that low. A triangle carries odd harmonics up
   * into the range a phone CAN reproduce, so the note reads as warmth rather
   * than as nothing — the standard trick for putting a bass note on a device
   * that has no bass.
   */
  wave?: OscillatorType;
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
  // Double-tap-to-Wow (owner, 2026-08-18: "double tap should have a haptic
  // sound different from other haptic sounds already made"). A quick two-note
  // ascending sparkle, brighter and richer than every single-blip tone above
  // (including "reaction", already spoken for elsewhere — see
  // wallpaper-reels.tsx) — the rising interval is what reads as a small
  // celebratory moment rather than another flavor of the same click.
  wow: [
    { freq: 880, at: 0, duration: 0.07, gain: 0.1 },
    { freq: 1320, at: 0.05, duration: 0.12, gain: 0.12 },
  ],
  /*
    The once-a-day streak celebration (owner, 2026-08-24: "make the streak
    animation style and text more luxurious with sound").


    A rising major triad resolving an octave up — C6·E6·G6·C7 — then a soft
    high shimmer. Every other tone here is one or two blips because they fire
    constantly; this one fires ONCE PER DAY, so it can afford to be a phrase
    rather than a beep, and a resolved octave is what reads as "achievement"
    instead of "notification". Gains taper across the run so it arrives warm
    and settles, rather than ending on the loudest note.

    Still synthesised, not an audio file: an asset would be a network fetch on
    a celebration that must appear instantly, and this is ~400ms of oscillator.
  */
  streak: [
    { freq: 1046.5, at: 0, duration: 0.13, gain: 0.11 },
    { freq: 1318.5, at: 0.085, duration: 0.13, gain: 0.115 },
    { freq: 1568.0, at: 0.17, duration: 0.15, gain: 0.12 },
    { freq: 2093.0, at: 0.26, duration: 0.26, gain: 0.1 },
    { freq: 2637.0, at: 0.33, duration: 0.3, gain: 0.045 },
  ],
  /*
    ═══════════════════════════════════════════════════════════════════════════
     THE MILESTONE (7 / 14 / 30 / 100 / 365 days)
    ═══════════════════════════════════════════════════════════════════════════

    §17: the milestone cue should be "slightly more distinctive but still
    elegant" — and, in the same breath, "Very short ... Subtle ... Never forced
    at high volume."

    🔴 SO IT IS RICHER, NOT LOUDER. Its peak gain is 0.10, BELOW the ordinary
    streak's 0.12 and below `mention`'s 0.13. Everything that makes it feel
    bigger is arrangement rather than level:

      • A low C3/G3 foundation the daily cue does not have. This is what gives
        the phrase a floor to sit on, and it is the quietest part of the sound
        (0.038) — weight comes from the interval being there at all, not from
        volume. `triangle` so a phone speaker can actually reproduce it.
      • The SAME C-major family as the daily cue, so the two are recognisably
        related — the audio equivalent of the milestone flame being the tier's
        own flame rather than a different mark.
      • It goes one step further than the daily phrase resolves: the daily
        settles on C7, this one passes through C7 and blooms back to a soft
        held C7 an eighth of a second later, which is what reads as arrival
        rather than acknowledgement.

    ~1.25s end to end, against a 3.5s ceremony — it finishes while the emblem
    is still settling and leaves the hold phase silent, which is what keeps it
    ceremonial instead of a jingle.
  */
  "streak-milestone": [
    // Foundation — felt, not noticed.
    { freq: 130.81, at: 0, duration: 1.0, gain: 0.038, wave: "triangle" }, // C3
    { freq: 196.0, at: 0.03, duration: 0.9, gain: 0.03, wave: "triangle" }, // G3
    // The rising figure, a fifth wider than the daily cue's.
    { freq: 1046.5, at: 0.06, duration: 0.14, gain: 0.095 }, // C6
    { freq: 1318.5, at: 0.15, duration: 0.14, gain: 0.1 }, // E6
    { freq: 1568.0, at: 0.24, duration: 0.16, gain: 0.1 }, // G6
    { freq: 2093.0, at: 0.34, duration: 0.3, gain: 0.095 }, // C7
    // Shimmer, then the bloom back to the tonic.
    { freq: 2637.0, at: 0.44, duration: 0.32, gain: 0.042 }, // E7
    { freq: 3136.0, at: 0.54, duration: 0.4, gain: 0.028 }, // G7
    { freq: 2093.0, at: 0.8, duration: 0.45, gain: 0.04 }, // C7, held soft
  ],
};

/**
 * Exported for `sound-fx.test.ts` only.
 *
 * §17 puts real constraints on these ("very short", "never forced at high
 * volume") and they are the kind of thing that drifts one edit at a time until
 * a celebration is shouting at somebody in a quiet room. A test can hold the
 * numbers; a comment cannot.
 */
export const SOUND_TONES: Readonly<Record<SoundType, readonly Note[]>> = TONES;

function playNote(audioCtx: AudioContext, note: Note): void {
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = note.wave ?? "sine";
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
