import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { encodeWav, looksLikeVideo, peakOf } from "./extract-audio";

/** Voice Cloning from a gallery video (owner, 2026-10-08). */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a video's sound, as a WAV", () => {
  it("writes a valid 16-bit mono PCM WAV header and data", async () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 22_050);
    const b = new DataView(await wav.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(36)).toBe("data");
    expect(b.getUint16(20, true)).toBe(1); // PCM
    expect(b.getUint16(22, true)).toBe(1); // mono
    expect(b.getUint32(24, true)).toBe(22_050);
    expect(b.getUint32(40, true)).toBe(10); // 5 samples × 2 bytes
    expect(b.getInt16(44 + 3 * 2, true)).toBe(0x7fff); // +1 clips to full scale
    expect(b.getInt16(44 + 4 * 2, true)).toBe(-0x8000);
    expect(wav.type).toBe("audio/wav");
  });

  it("knows a gallery video by type or extension, and never mistakes audio for one", () => {
    expect(looksLikeVideo({ name: "IMG_0412.MOV", type: "video/quicktime" })).toBe(true);
    expect(looksLikeVideo({ name: "clip.mp4", type: "" })).toBe(true);
    expect(looksLikeVideo({ name: "note.m4a", type: "audio/x-m4a" })).toBe(false);
    expect(looksLikeVideo({ name: "voice.mp4", type: "audio/mp4" })).toBe(false);
  });

  it("a silent track is recognised (the 'we couldn't hear a voice' case)", () => {
    expect(peakOf(new Float32Array(1000))).toBe(0);
    expect(peakOf(new Float32Array([0, -0.4, 0.2]))).toBeCloseTo(0.4);
  });
});

describe("the clone pipeline carries 'from a video' to the provider's noise removal", () => {
  it("the picker takes videos instead of refusing them as 'not audio files'", () => {
    const hook = src("features/ai/voice-clone/use-voice-cloning.ts");
    expect(hook).not.toContain("Those are not audio files");
    expect(hook).toContain("await extractAudioAsWav(file, { maxSeconds: limits?.maximumSecondsEach ?? 300 })");
    expect(src("features/ai/voice-clone/voice-cloning-workspace.tsx")).toContain('acceptExtensions, "video/*"]');
  });

  it("fromVideo → job metadata → run → remove_background_noise, and only then", () => {
    expect(src("lib/ai/voice-clone/schemas.ts")).toContain("fromVideo: z.boolean().optional(),");
    expect(src("lib/ai/voice-clone/create.ts")).toContain("...(s.fromVideo ? { fromVideo: true } : {})");
    expect(src("lib/ai/voice-clone/run.ts")).toContain("removeBackgroundNoise: meta.samples.some((s) => s.fromVideo === true),");
    expect(src("lib/ai/voice/elevenlabs.ts")).toContain('if (req.removeBackgroundNoise) form.set("remove_background_noise", "true");');
  });
});
