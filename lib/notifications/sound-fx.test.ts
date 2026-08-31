import { describe, expect, it } from "vitest";

import { SOUND_TONES } from "./sound-fx";

/*
  ── Why this suite exists ──────────────────────────────────────────────────

  The streak spec (§17) puts real, checkable constraints on the celebration
  cues: "Very short ... Premium ... Subtle ... Not annoying ... Never forced at
  high volume", and the milestone one should be "slightly more distinctive but
  still elegant" than the daily one.

  Those are exactly the numbers that drift one well-meaning edit at a time —
  someone nudges a gain because it was quiet on their laptop, and a celebration
  ends up shouting at somebody in a quiet room. A comment cannot hold them.

  The tones are pure data (frequency/time/gain), so this asserts on the DATA
  rather than trying to render audio: no AudioContext, no timing, no flake.
*/

const peak = (type: keyof typeof SOUND_TONES) =>
  Math.max(...SOUND_TONES[type].map((n) => n.gain));

const endsAt = (type: keyof typeof SOUND_TONES) =>
  Math.max(...SOUND_TONES[type].map((n) => n.at + n.duration));

describe("the milestone cue", () => {
  it("exists and is a phrase, not a blip", () => {
    const notes = SOUND_TONES["streak-milestone"];
    expect(notes.length).toBeGreaterThanOrEqual(6);
  });

  /*
    🔴 THE ONE THAT MATTERS. "More distinctive" must never be delivered as
    "louder" — the richness is meant to come from arrangement.
  */
  it("🔴 is NOT louder than the ordinary streak cue", () => {
    expect(peak("streak-milestone")).toBeLessThanOrEqual(peak("streak"));
  });

  it("🔴 is not the loudest sound in the app", () => {
    const loudest = Math.max(
      ...(Object.keys(SOUND_TONES) as (keyof typeof SOUND_TONES)[]).map(peak),
    );
    expect(peak("streak-milestone")).toBeLessThan(loudest);
  });

  /* §17: "Very short". It also has to finish inside the ~3.5s ceremony and
     leave the hold phase silent, or it stops reading as ceremonial. */
  it("🔴 stays short — under 1.5s, and well inside the ceremony", () => {
    expect(endsAt("streak-milestone")).toBeLessThan(1.5);
  });

  it("is distinguishable from the daily cue rather than a longer copy of it", () => {
    const daily = SOUND_TONES.streak.map((n) => n.freq);
    const milestone = SOUND_TONES["streak-milestone"].map((n) => n.freq);
    expect(milestone).not.toEqual(daily);
    // The foundation notes are the audible difference: the daily cue has
    // nothing below C6, the milestone is built on a low root.
    expect(Math.min(...daily)).toBeGreaterThan(1000);
    expect(Math.min(...milestone)).toBeLessThan(300);
  });

  /* A sine at 130Hz is inaudible on a phone speaker — see the note on `wave`. */
  it("🔴 uses a non-sine wave for the sub-bass foundation", () => {
    const low = SOUND_TONES["streak-milestone"].filter((n) => n.freq < 300);
    expect(low.length).toBeGreaterThan(0);
    for (const n of low) expect(n.wave).toBe("triangle");
  });
});

describe("every cue", () => {
  it("🔴 keeps ambient sounds quiet — the ones that fire constantly", () => {
    // These play on ordinary interaction, so they must stay near-subliminal.
    for (const type of ["typing", "tap", "reaction"] as const) {
      expect(peak(type)).toBeLessThanOrEqual(0.09);
    }
  });

  it("never exceeds a safe level", () => {
    for (const type of Object.keys(SOUND_TONES) as (keyof typeof SOUND_TONES)[]) {
      expect(peak(type)).toBeLessThanOrEqual(0.15);
    }
  });

  it("has no note starting before zero or with a non-positive duration", () => {
    for (const type of Object.keys(SOUND_TONES) as (keyof typeof SOUND_TONES)[]) {
      for (const n of SOUND_TONES[type]) {
        expect(n.at).toBeGreaterThanOrEqual(0);
        expect(n.duration).toBeGreaterThan(0);
        expect(n.gain).toBeGreaterThan(0);
      }
    }
  });
});
