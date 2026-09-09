import { describe, expect, it } from "vitest";

import {
  buildRestoreArgs,
  canStreamCopy,
  checkFinalProbe,
  DURATION_TOLERANCE_SECONDS,
  expectedFinalDuration,
  parseProbeOutput,
  type MediaProbe,
} from "./ffmpeg-plan";

/**
 * The finalizer's decisions, tested without ffmpeg.
 *
 * The argument list is the security property of the whole worker: "no user
 * input reaches ffmpeg" is a claim, and this is what makes it checkable. The
 * rest is the difference between handing somebody a finished video and handing
 * them a silent one.
 */

const PATHS = {
  cleanedPath: "/tmp/frenz-ai/job/cleaned.bin",
  sourcePath: "/tmp/frenz-ai/job/source.bin",
  outPath: "/tmp/frenz-ai/job/final.mp4",
};

describe("buildRestoreArgs — video with audio, stream copy", () => {
  const args = buildRestoreArgs({ ...PATHS, hasAudio: true, canCopyVideo: true });

  it("builds the owner's specified command", () => {
    expect(args).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      PATHS.cleanedPath,
      "-i",
      PATHS.sourcePath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0?",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      PATHS.outPath,
    ]);
  });

  it("takes the picture from the CLEANED file and the sound from the ORIGINAL", () => {
    // Reversed, this would hand back the untouched original with the text still
    // on it — a job that reports success and did nothing.
    expect(args.indexOf("-i")).toBeLessThan(args.lastIndexOf("-i"));
    expect(args[args.indexOf("-i") + 1]).toBe(PATHS.cleanedPath);
    expect(args[args.lastIndexOf("-i") + 1]).toBe(PATHS.sourcePath);
    expect(args).toContain("0:v:0"); // video from input 0, the cleaned one
    expect(args).toContain("1:a:0?"); // audio from input 1, the original
  });

  it("never re-encodes a video it can copy", () => {
    expect(args).toContain("copy");
    expect(args).not.toContain("libx264");
  });

  it("starts the file with its index so playback can begin early", () => {
    expect(args).toContain("+faststart");
  });
});

describe("buildRestoreArgs — video with NO audio", () => {
  const args = buildRestoreArgs({ ...PATHS, hasAudio: false, canCopyVideo: true });

  it("🔴 still produces a video — a silent source is a success, not a failure", () => {
    expect(args).toContain("-an");
    expect(args).toContain(PATHS.outPath);
  });

  it("does not open the original at all", () => {
    // Nothing to take from it, so ffmpeg is not asked to index a second large
    // file for nothing.
    expect(args).not.toContain(PATHS.sourcePath);
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
  });

  it("omits the audio map and -shortest, which would mean nothing here", () => {
    expect(args).not.toContain("1:a:0?");
    expect(args).not.toContain("-shortest");
  });
});

describe("buildRestoreArgs — the re-encode fallback", () => {
  const args = buildRestoreArgs({ ...PATHS, hasAudio: true, canCopyVideo: false });

  it("uses fixed, conservative settings", () => {
    expect(args).toContain("libx264");
    expect(args).toContain("-crf");
    expect(args).toContain("20");
    expect(args).toContain("yuv420p");
    expect(args).not.toContain("copy");
  });
});

describe("🔴 the arguments cannot be influenced from outside", () => {
  it("passes hostile paths as single array elements, never as shell text", () => {
    /*
      The paths are built by the server from tmpdir() and a job id, so these
      values cannot actually occur — this proves the SHAPE that makes that
      safe. Handed to spawn as an array, an argument containing a semicolon,
      a quote or a backtick is one argument, not a command. There is no shell,
      no word splitting and no quoting to get wrong.
    */
    const hostile = "/tmp/x; rm -rf /; echo `whoami`.mp4";
    const args = buildRestoreArgs({ ...PATHS, outPath: hostile, hasAudio: true, canCopyVideo: true });
    expect(args.filter((a) => a === hostile)).toHaveLength(1);
    expect(args[args.length - 1]).toBe(hostile);
  });

  it("contains no argument that is not a constant or one of the three paths", () => {
    // The real guarantee: every element is either a flag this file chose or a
    // path the server built. A new interpolated value would fail this.
    const args = buildRestoreArgs({ ...PATHS, hasAudio: true, canCopyVideo: false });
    const paths = new Set(Object.values(PATHS));
    const constants = new Set([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", "-map", "0:v:0", "1:a:0?",
      "-c:v", "copy", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-shortest", "-an", "-movflags", "+faststart",
    ]);
    for (const arg of args) {
      expect(paths.has(arg) || constants.has(arg), `unexpected argument: ${arg}`).toBe(true);
    }
  });
});

describe("canStreamCopy", () => {
  it("copies what MP4 can already carry", () => {
    for (const codec of ["h264", "H264", "hevc", "av1"]) {
      expect(canStreamCopy(codec), codec).toBe(true);
    }
  });

  it("re-encodes anything else, including an unknown codec", () => {
    for (const codec of ["vp9", "theora", "prores", null, ""]) {
      expect(canStreamCopy(codec), String(codec)).toBe(false);
    }
  });
});

describe("parseProbeOutput", () => {
  const probeJson = (streams: unknown[], format: Record<string, unknown> = {}) =>
    JSON.stringify({ streams, format: { duration: "12.5", format_name: "mov,mp4", size: "1024", ...format } });

  it("reads the streams and the format", () => {
    const probe = parseProbeOutput(
      probeJson([
        { codec_type: "video", codec_name: "h264", width: 1280, height: 720 },
        { codec_type: "audio", codec_name: "aac" },
      ]),
    );
    expect(probe).toMatchObject({
      durationSeconds: 12.5,
      width: 1280,
      height: 720,
      videoCodec: "h264",
      audioCodec: "aac",
      hasAudio: true,
      hasVideo: true,
    });
  });

  it("🔴 reports a silent file as having no audio, rather than guessing", () => {
    const probe = parseProbeOutput(probeJson([{ codec_type: "video", codec_name: "h264" }]));
    expect(probe?.hasAudio).toBe(false);
    expect(probe?.audioCodec).toBeNull();
  });

  it("treats an unreadable duration as not measured — never as zero", () => {
    for (const duration of ["0", "N/A", ""]) {
      const probe = parseProbeOutput(probeJson([{ codec_type: "video" }], { duration }));
      expect(probe?.durationSeconds, duration).toBeNull();
    }
  });

  it("returns null for output that is not JSON", () => {
    expect(parseProbeOutput("")).toBeNull();
    expect(parseProbeOutput("ffprobe: command not found")).toBeNull();
  });
});

describe("checkFinalProbe", () => {
  const good: MediaProbe = {
    durationSeconds: 12.5,
    width: 1280,
    height: 720,
    videoCodec: "h264",
    audioCodec: "aac",
    frameRate: 30,
    hasAudio: true,
    hasVideo: true,
    formatName: "mov,mp4",
    bytes: 1024,
  };

  it("accepts a finished video with its audio", () => {
    expect(checkFinalProbe(good, { expectAudio: true, expectedDurationSeconds: 12.5 })).toEqual({ ok: true });
  });

  it("🔴 REFUSES a silent result when the source had sound", () => {
    // The whole point of Part 4. A silent video here is the failure this stage
    // exists to prevent, and it must never be marked completed.
    const silent = { ...good, hasAudio: false, audioCodec: null };
    const verdict = checkFinalProbe(silent, { expectAudio: true, expectedDurationSeconds: 12.5 });
    expect(verdict.ok).toBe(false);
  });

  it("accepts a silent result when the source had none", () => {
    const silent = { ...good, hasAudio: false, audioCodec: null };
    expect(checkFinalProbe(silent, { expectAudio: false, expectedDurationSeconds: 12.5 })).toEqual({ ok: true });
  });

  it("🔴 refuses a truncated mux", () => {
    // A two-second file from a twelve-second video is the failure a member
    // would otherwise discover by pressing play.
    const truncated = { ...good, durationSeconds: 2 };
    expect(checkFinalProbe(truncated, { expectAudio: true, expectedDurationSeconds: 12.5 }).ok).toBe(false);
  });

  it("tolerates the small drift -shortest and container rounding produce", () => {
    const trimmed = { ...good, durationSeconds: 12.5 - (DURATION_TOLERANCE_SECONDS - 0.1) };
    expect(checkFinalProbe(trimmed, { expectAudio: true, expectedDurationSeconds: 12.5 }).ok).toBe(true);
  });

  it("refuses a file with no video stream, or one it could not read", () => {
    expect(checkFinalProbe({ ...good, hasVideo: false }, { expectAudio: false, expectedDurationSeconds: null }).ok).toBe(false);
    expect(checkFinalProbe(null, { expectAudio: false, expectedDurationSeconds: null }).ok).toBe(false);
    expect(checkFinalProbe({ ...good, durationSeconds: null }, { expectAudio: false, expectedDurationSeconds: null }).ok).toBe(false);
  });
});

describe("expectedFinalDuration", () => {
  it("is the shorter input when audio is being restored, because -shortest trims", () => {
    expect(expectedFinalDuration({ hasAudio: true, sourceDuration: 12.5, cleanedDuration: 12.1 })).toBe(12.1);
    expect(expectedFinalDuration({ hasAudio: true, sourceDuration: 11.9, cleanedDuration: 12.1 })).toBe(11.9);
  });

  it("is the cleaned file alone when there is no audio — the source is never opened", () => {
    expect(expectedFinalDuration({ hasAudio: false, sourceDuration: 30, cleanedDuration: 12.1 })).toBe(12.1);
  });

  it("falls back rather than inventing a number when one side is unmeasured", () => {
    expect(expectedFinalDuration({ hasAudio: true, sourceDuration: null, cleanedDuration: 12.1 })).toBe(12.1);
    expect(expectedFinalDuration({ hasAudio: true, sourceDuration: null, cleanedDuration: null })).toBeNull();
  });
});
