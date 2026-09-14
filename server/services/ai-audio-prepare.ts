import { spawn } from "node:child_process";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { AiFeature } from "@/lib/ai/jobs";
import { AI_SOURCE_BUCKET, aiVoicePreparedKey, pathBelongsTo } from "@/lib/ai/storage";
import { buildAudioPrepareArgs, isKnownAudioArg, isWavCompatible, type AudioPreparePlan } from "@/lib/ai/voice/audio-ffmpeg";
import { decideAudioFit, sniffAudioContainer, sniffedContainerAgrees, validateProbedAudio, type AudioFitPolicy, type ProbedAudio } from "@/lib/ai/voice/audio-validate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPLACEMENT AUDIO ON THE WORKER — validate, fit, normalise, store
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 6 §3–§4. One function for BOTH sources of a new voice: the
 * member's upload (called from the prepare service, before anything is
 * charged to a provider) and the generated voice (called from the advance
 * service, after the TTS stage). Each hands it a file on disk, the video's
 * measured length and the operator's fit policy; it answers with the stored
 * WAV's facts or a refusal code the caller turns into a refund.
 *
 *   1. the first bytes must be a real audio container we take (§3: never the
 *      name or the type — a PDF called song.mp3 stops here);
 *   2. ffprobe measures it: a readable audio stream in an accepted codec, no
 *      video stream, within the operator's length ceiling;
 *   3. `decideAudioFit` (pure) decides keep / trim / pad / refuse against the
 *      VIDEO's length — the member's `trimToFit` is the only thing that
 *      permits a cut, and nothing is ever stretched or looped;
 *   4. one ffmpeg plan — a fixed argument array, proven element by element —
 *      writes the WAV, copying the stream when it is already compatible;
 *   5. the result is probed again (a WAV of the expected length, or nothing)
 *      and stored beside the job's other objects, at a key this file built.
 *
 * Nothing about the audio is logged but its facts (§24): durations, rates,
 * codecs, sizes. Never a transcript, never a URL.
 */

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const FFPROBE_TIMEOUT_MS = Number(process.env.AI_FFPROBE_TIMEOUT_MS || 30_000);
const FFMPEG_TIMEOUT_MS = 5 * 60_000;

export type AudioPrepareFailureCode = "AUDIO_INVALID" | "AUDIO_TOO_LONG" | "AUDIO_TOO_SHORT";

export type AudioPrepareOutcome =
  | {
      ok: true;
      path: string;
      durationMs: number;
      sampleRate: number | null;
      channels: number | null;
      codec: string | null;
      bitrate: number | null;
      bytes: number;
      trimmed: boolean;
      padded: boolean;
      transcoded: boolean;
      /** What the input measured as, for the row. */
      input: { durationMs: number; codec: string | null; sampleRate: number | null; channels: number | null; bitrate: number | null; container: string | null };
    }
  | { ok: false; code: AudioPrepareFailureCode; detail: string };

export async function prepareReplacementAudio(opts: {
  jobId: string;
  ownerId: string;
  feature: AiFeature;
  /** The audio file on disk (downloaded by the caller with its ceiling enforced). */
  inputFile: string;
  /** A scratch directory the caller owns and cleans. */
  dir: string;
  /** The kept video's measured length, integer milliseconds. */
  videoMs: number;
  policy: AudioFitPolicy;
  limits: { maxDurationMs: number };
  /** The member's claims, when this is an upload — checked against the bytes. Null for a generated voice. */
  declared: { name: string; type: string } | null;
}): Promise<AudioPrepareOutcome> {
  /* ── 1. the signature ───────────────────────────────────────────────── */
  const head = await readHead(opts.inputFile, 16);
  const container = sniffAudioContainer(head);
  if (opts.declared && !sniffedContainerAgrees(container, opts.declared)) {
    return { ok: false, code: "AUDIO_INVALID", detail: `signature ${container ?? "unknown"} does not match the declared kind` };
  }
  if (!container) return { ok: false, code: "AUDIO_INVALID", detail: "no audio container signature" };

  /* ── 2. the facts ───────────────────────────────────────────────────── */
  const probe = await probeAudio(opts.inputFile);
  const verdict = validateProbedAudio(probe, { maxDurationMs: opts.limits.maxDurationMs, minDurationMs: 200 });
  if (!verdict.ok) {
    const code: AudioPrepareFailureCode = verdict.code === "audio-too-long" ? "AUDIO_TOO_LONG" : verdict.code === "audio-too-short" ? "AUDIO_TOO_SHORT" : "AUDIO_INVALID";
    return { ok: false, code, detail: `probe: ${verdict.code}` };
  }
  const audioMs = Math.round((probe!.durationSeconds ?? 0) * 1000);

  /* ── 3. the fit — the authoritative decision (§4) ───────────────────── */
  const fit = decideAudioFit(audioMs, opts.videoMs, opts.policy);
  if (!fit.ok) {
    const code: AudioPrepareFailureCode = fit.code === "audio-longer-than-video" ? "AUDIO_TOO_LONG" : "AUDIO_TOO_SHORT";
    return { ok: false, code, detail: `${fit.code}: audio ${audioMs} ms, video ${opts.videoMs} ms` };
  }

  /* ── 4. the WAV ─────────────────────────────────────────────────────── */
  const output = path.join(opts.dir, "voice-prepared.wav");
  const plan: AudioPreparePlan = { input: opts.inputFile, output, action: fit.action, videoMs: opts.videoMs, compatible: isWavCompatible(probe!) };
  const args = buildAudioPrepareArgs(plan);
  for (const arg of args) if (!isKnownAudioArg(arg, plan)) return { ok: false, code: "AUDIO_INVALID", detail: "refusing an unknown ffmpeg argument" };
  const ran = await runFfmpeg(args);
  if (!ran.ok) return { ok: false, code: "AUDIO_INVALID", detail: `ffmpeg: ${ran.detail.slice(0, 300)}` };

  /* ── 5. the result, measured, then stored ───────────────────────────── */
  const outStat = await stat(output).catch(() => null);
  if (!outStat || outStat.size <= 44) return { ok: false, code: "AUDIO_INVALID", detail: "ffmpeg wrote nothing" };
  const outProbe = await probeAudio(output);
  const outMs = Math.round((outProbe?.durationSeconds ?? 0) * 1000);
  if (!outProbe?.hasAudio || outMs <= 0) return { ok: false, code: "AUDIO_INVALID", detail: "the prepared audio has no readable stream" };
  const expectedMs = fit.action === "keep" ? audioMs : opts.videoMs;
  if (Math.abs(outMs - expectedMs) > Math.max(500, Math.round(expectedMs * 0.03))) {
    return { ok: false, code: "AUDIO_INVALID", detail: `prepared ${outMs} ms, expected about ${expectedMs} ms` };
  }

  const key = aiVoicePreparedKey(opts.ownerId, opts.feature, opts.jobId);
  if (!pathBelongsTo(key, opts.ownerId, opts.jobId)) return { ok: false, code: "AUDIO_INVALID", detail: "refusing a prepared path that failed ownership" };
  const body = await readFile(output);
  const up = await createAdminClient().storage.from(AI_SOURCE_BUCKET).upload(key, body, { contentType: "audio/wav", upsert: true });
  if (up.error) return { ok: false, code: "AUDIO_INVALID", detail: `upload failed: ${up.error.message}` };

  return {
    ok: true,
    path: key,
    durationMs: outMs,
    sampleRate: outProbe.sampleRate,
    channels: outProbe.channels,
    codec: outProbe.audioCodec,
    bitrate: outProbe.bitrate,
    bytes: body.byteLength,
    trimmed: fit.action === "trim",
    padded: fit.action === "pad",
    transcoded: !plan.compatible || fit.action === "pad",
    input: { durationMs: audioMs, codec: probe!.audioCodec, sampleRate: probe!.sampleRate, channels: probe!.channels, bitrate: probe!.bitrate, container },
  };
}

async function readHead(file: string, bytes: number): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const buf = new Uint8Array(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** ffprobe, for the facts an audio file has that the video probe does not read: rate, channels, bitrate. */
export function probeAudio(file: string): Promise<ProbedAudio | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    let settled = false;
    const finish = (value: ProbedAudio | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, FFPROBE_TIMEOUT_MS);
    child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0) return finish(null);
      try {
        const parsed = JSON.parse(out) as {
          streams?: { codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; bit_rate?: string }[];
          format?: { duration?: string; bit_rate?: string };
        };
        const streams = parsed.streams ?? [];
        const audio = streams.find((s) => s.codec_type === "audio");
        const video = streams.find((s) => s.codec_type === "video");
        const duration = Number(parsed.format?.duration);
        const bitrate = Number(audio?.bit_rate ?? parsed.format?.bit_rate);
        finish({
          hasAudio: !!audio,
          // An embedded cover art stream in an MP3 is "video" to ffprobe; only count a real picture stream.
          hasVideo: !!video && !["mjpeg", "png", "bmp", "gif"].includes((video.codec_name ?? "").toLowerCase()),
          durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
          audioCodec: audio?.codec_name?.toLowerCase() ?? null,
          sampleRate: audio?.sample_rate ? Number(audio.sample_rate) || null : null,
          channels: typeof audio?.channels === "number" ? audio.channels : null,
          bitrate: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate) : null,
        });
      } catch {
        finish(null);
      }
    });
  });
}

function runFfmpeg(args: string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(FFMPEG, args, { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, detail: `spawn failed: ${String(e)}` });
      return;
    }
    let err = "";
    let settled = false;
    const finish = (value: { ok: boolean; detail: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, detail: "ffmpeg exceeded its timeout" });
    }, FFMPEG_TIMEOUT_MS);
    child.stderr?.on("data", (c: Buffer) => {
      if (err.length < 8_000) err += c.toString();
    });
    child.on("error", (e) => finish({ ok: false, detail: String(e) }));
    child.on("close", (code) => finish(code === 0 ? { ok: true, detail: "" } : { ok: false, detail: err.slice(0, 2000) || `exit ${code}` }));
  });
}
