import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { copyFile, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withDownloadSlot } from "@/lib/concurrency";
import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

import { getOrProduce, type DownloadResult } from "./download-cache";

// Optional Netscape-format cookies (set YTDLP_COOKIES to the cookies.txt
// contents) — lets yt-dlp authenticate sign-in-walled sites like Instagram,
// Facebook and private/age-gated videos. Written once to a temp file.
let cookiesFile: string | null = null;
if (process.env.YTDLP_COOKIES) {
  try {
    const path = join(tmpdir(), "svd-cookies.txt");
    writeFileSync(path, process.env.YTDLP_COOKIES, "utf8");
    cookiesFile = path;
  } catch {
    cookiesFile = null;
  }
}
function cookieArgs(): string[] {
  return cookiesFile ? ["--cookies", cookiesFile] : [];
}

/**
 * Thin, typed wrapper around the yt-dlp binary.
 *
 * Design notes:
 *  - All arguments are passed as an argv array to `spawn` (never a shell
 *    string) so user-supplied URLs cannot inject shell commands.
 *  - Metadata extraction is buffered (small JSON); downloads are streamed so
 *    we never hold an entire video in memory.
 *  - A hard timeout guards against hung extractions.
 */

const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
const FFMPEG_PATH = process.env.FFMPEG_PATH;
const ARIA2C_PATH = process.env.ARIA2C_PATH;
const METADATA_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS || 25_000);
// Idle timeout: abort a download only after this many ms with NO progress
// output (a genuine hang). Long videos/audio that keep advancing are never cut
// off. Default 3 minutes of silence.
const DOWNLOAD_IDLE_TIMEOUT_MS = Number(
  process.env.YTDLP_DOWNLOAD_IDLE_TIMEOUT_MS || 180_000,
);
// Parallel fragment downloads for the native downloader (DASH/HLS speedup).
const CONCURRENT_FRAGMENTS = Math.max(
  1,
  Number(process.env.YTDLP_CONCURRENT_FRAGMENTS || 8),
);

/** Adds `--ffmpeg-location` when an explicit ffmpeg path is configured. */
function withFfmpeg(args: string[]): string[] {
  return FFMPEG_PATH ? ["--ffmpeg-location", FFMPEG_PATH, ...args] : args;
}

// aria2c is only enabled when explicitly opted in. Empirically it SPEEDS UP
// direct-CDN downloads (TikTok/Instagram) but SLOWS DOWN throttled sources like
// YouTube, whose servers penalise many parallel connections. The native
// parallel-fragment downloader is the safer, faster default for most traffic.
const USE_ARIA2C = !!ARIA2C_PATH && process.env.USE_ARIA2C === "true";

/**
 * Download-acceleration flags. Default: yt-dlp's native parallel-fragment
 * downloader. Opt-in: aria2c multi-connection downloader (set USE_ARIA2C=true).
 */
function accelArgs(): string[] {
  if (USE_ARIA2C) {
    return [
      "--downloader",
      ARIA2C_PATH!,
      "--downloader-args",
      "aria2c:-x8 -s8 -k1M --max-tries=2 --retry-wait=1",
    ];
  }
  return ["--concurrent-fragments", String(CONCURRENT_FRAGMENTS)];
}

export class YtDlpError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "EXTRACTION_FAILED"
      | "DOWNLOAD_FAILED"
      | "TIMEOUT"
      | "NOT_INSTALLED",
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "YtDlpError";
  }
}

/** Shape of the subset of yt-dlp's `-J` output that we consume. */
interface RawFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  fps?: number;
  tbr?: number;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
}

interface RawInfo {
  id?: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  creator?: string;
  upload_date?: string;
  view_count?: number;
  like_count?: number;
  webpage_url?: string;
  extractor_key?: string;
  formats?: RawFormat[];
}

function runYtDlp(
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(YTDLP_BIN, args, { windowsHide: true });
    } catch {
      reject(new YtDlpError("yt-dlp binary not found", "NOT_INSTALLED"));
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new YtDlpError("yt-dlp timed out", "TIMEOUT"));
    }, timeoutMs);

    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new YtDlpError("yt-dlp binary not found", "NOT_INSTALLED"));
      } else {
        reject(new YtDlpError(err.message, "EXTRACTION_FAILED"));
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(
          new YtDlpError(
            "yt-dlp exited with a non-zero status",
            "EXTRACTION_FAILED",
            err,
          ),
        );
        return;
      }
      resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: err });
    });
  });
}

/**
 * Maps yt-dlp's raw formats into clean, height-based quality tiers.
 *
 * The `formatId` we expose is a *download selector* — a height (e.g. "1080")
 * for video, or "audio" for audio — NOT a raw yt-dlp format id. This makes the
 * download step robust: yt-dlp resolves the best mp4-native streams at (or
 * below) that height itself, so we never accidentally append a second audio
 * track to an already-progressive format.
 */
function mapFormats(raw: RawFormat[] | undefined): MediaFormat[] {
  if (!raw?.length) return [];

  // Collapse video formats into one entry per height, preferring the variant
  // with the highest bitrate so the displayed size is representative.
  const byHeight = new Map<number, { fps: number | null; tbr: number; filesize: number | null }>();
  let hasAnyAudio = false;
  // Some platforms (Instagram, Facebook, X) return video formats WITHOUT a
  // height. We must still offer a video option for those, or the UI would only
  // show audio. Track the best such heightless video as a fallback "Best" tier.
  let bestHeightless: { tbr: number; filesize: number | null } | null = null;

  for (const f of raw) {
    const hasVideo = !!f.vcodec && f.vcodec !== "none";
    const hasAudio = !!f.acodec && f.acodec !== "none";
    if (hasAudio) hasAnyAudio = true;
    if (!hasVideo) continue;

    const size = f.filesize ?? f.filesize_approx ?? null;
    const tbr = f.tbr ?? 0;

    if (f.height) {
      const existing = byHeight.get(f.height);
      if (!existing || tbr > existing.tbr) {
        byHeight.set(f.height, { fps: f.fps ?? null, tbr, filesize: size });
      }
    } else if (!bestHeightless || tbr > bestHeightless.tbr) {
      bestHeightless = { tbr, filesize: size };
    }
  }

  let video: MediaFormat[] = [...byHeight.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([height, info]) => ({
      formatId: String(height),
      kind: "video" as const,
      label: `${height}p`,
      ext: "mp4",
      resolution: `${height}p`,
      fps: info.fps,
      filesize: info.filesize,
      tbr: info.tbr || null,
      vcodec: null,
      acodec: null,
    }));

  // No height-tagged video tiers but a video stream exists → offer "Best".
  if (video.length === 0 && bestHeightless) {
    video = [
      {
        formatId: "best",
        kind: "video",
        label: "Best quality",
        ext: "mp4",
        resolution: null,
        fps: null,
        filesize: bestHeightless.filesize,
        tbr: bestHeightless.tbr || null,
        vcodec: null,
        acodec: null,
      },
    ];
  }

  // A single, predictable MP3 audio option (server transcodes to MP3).
  const audio: MediaFormat[] = hasAnyAudio
    ? [
        {
          formatId: "audio",
          kind: "audio",
          label: "MP3 audio",
          ext: "mp3",
          resolution: null,
          fps: null,
          filesize: null,
          tbr: null,
          vcodec: null,
          acodec: null,
        },
      ]
    : [];

  return [...video, ...audio];
}

function mapInfo(info: RawInfo, sourceUrl: string): VideoMetadata {
  const platform = detectPlatform(sourceUrl);
  return {
    id: info.id || crypto.randomUUID(),
    platform: platform.id,
    platformName: platform.name,
    sourceUrl,
    title: info.title?.trim() || "Untitled",
    description: info.description?.trim() || null,
    thumbnail: info.thumbnail || null,
    durationSeconds: info.duration ?? null,
    creator: info.uploader || info.channel || info.creator || null,
    uploadDate: info.upload_date
      ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
      : null,
    viewCount: info.view_count ?? null,
    likeCount: info.like_count ?? null,
    webpageUrl: info.webpage_url || sourceUrl,
    formats: mapFormats(info.formats),
    extractor: "ytdlp",
  };
}

/** Extracts metadata + available formats for a single media URL. */
export async function extractMetadata(url: string): Promise<VideoMetadata> {
  const { stdout } = await runYtDlp(
    [
      "-J",
      "--no-playlist",
      "--no-warnings",
      "--no-call-home",
      "--socket-timeout",
      "15",
      ...cookieArgs(),
      url,
    ],
    METADATA_TIMEOUT_MS,
  );

  let info: RawInfo;
  try {
    info = JSON.parse(stdout) as RawInfo;
  } catch {
    throw new YtDlpError("Could not parse extractor output", "EXTRACTION_FAILED");
  }
  return mapInfo(info, url);
}


/** Builds the yt-dlp argv + container metadata for a requested download. */
function buildDownloadArgs(
  url: string,
  formatId: string,
  kind: MediaKind,
  outputTemplate: string,
): { args: string[]; ext: string; contentType: string } {
  if (kind === "audio") {
    // Transcode to MP3 — predictable and universally playable.
    return {
      ext: "mp3",
      contentType: "audio/mpeg",
      args: withFfmpeg([
        ...accelArgs(),
        ...cookieArgs(),
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "-o",
        outputTemplate,
        "--newline",
        "--retries",
        "3",
        "--fragment-retries",
        "5",
        "--no-playlist",
        "--no-warnings",
        url,
      ]),
    };
  }

  // `formatId` is a height tier ("1080", "720", …) or "best". We select the best
  // mp4-native streams AT the requested height and merge them (h264+m4a so
  // ffmpeg STREAM-COPIES rather than re-encodes). Speed comes from the parallel
  // downloader (aria2c / concurrent fragments), not from downgrading quality —
  // so a 1080p request always yields true 1080p, never a smaller progressive.
  // Where a single-file progressive already exists at the exact height, yt-dlp
  // uses it (no merge). "best" is capped at 1080p to avoid multi-GB 4K files.
  const height = formatId === "best" ? 1080 : parseInt(formatId, 10) || 1080;
  const selector =
    `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/` +
    `best[height<=${height}][ext=mp4]/` +
    `bestvideo[height<=${height}]+bestaudio/` +
    `best[height<=${height}]/best`;

  return {
    ext: "mp4",
    contentType: "video/mp4",
    args: withFfmpeg([
      ...accelArgs(),
      ...cookieArgs(),
      "-f",
      selector,
      "--merge-output-format",
      "mp4",
      "-o",
      outputTemplate,
      "--newline",
      "--retries",
      "3",
      "--fragment-retries",
      "5",
      "--no-playlist",
      "--no-warnings",
      url,
    ]),
  };
}

function runDownloadProcess(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(YTDLP_BIN, args, { windowsHide: true });
    } catch {
      reject(new YtDlpError("yt-dlp binary not found", "NOT_INSTALLED"));
      return;
    }

    const stderr: Buffer[] = [];
    let settled = false;

    // Inactivity (idle) timeout rather than a hard wall: a long video or audio
    // can take many minutes to download/transcode and that's fine — we only
    // abort if the process produces NO output for DOWNLOAD_IDLE_TIMEOUT_MS,
    // which indicates a genuine hang. The timer is reset on every progress
    // chunk, so arbitrarily long downloads succeed as long as they advance.
    let idleTimer: NodeJS.Timeout;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new YtDlpError("download stalled", "TIMEOUT"));
      }, DOWNLOAD_IDLE_TIMEOUT_MS);
    };
    resetIdle();

    child.stderr.on("data", (c: Buffer) => {
      // Cap retained stderr so a very long, chatty download can't grow memory.
      if (stderr.length < 200) stderr.push(c);
      resetIdle();
    });
    child.stdout?.on("data", resetIdle);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      reject(
        err.code === "ENOENT"
          ? new YtDlpError("yt-dlp binary not found", "NOT_INSTALLED")
          : new YtDlpError(err.message, "DOWNLOAD_FAILED"),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      if (code === 0) resolve();
      else
        reject(
          new YtDlpError(
            "yt-dlp download failed",
            "DOWNLOAD_FAILED",
            Buffer.concat(stderr).toString("utf8"),
          ),
        );
    });
  });
}

/** Replaces the `-o` output template in an arg list. */
function withOutputTemplate(args: string[], template: string): string[] {
  const out = [...args];
  const i = out.indexOf("-o");
  if (i !== -1 && i + 1 < out.length) out[i + 1] = template;
  return out;
}

/** Moves a file, falling back to copy+unlink across filesystems (EXDEV). */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await copyFile(from, to);
      await rm(from, { force: true });
    } else {
      throw err;
    }
  }
}

/**
 * Runs yt-dlp into its OWN temp dir (so the merged output can be located by the
 * `media.*` name), then moves the finished file to `finalPath`. The temp dir is
 * always removed afterwards.
 */
async function produceTo(baseArgs: string[], finalPath: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "svd-"));
  try {
    const args = withOutputTemplate(baseArgs, join(dir, "media.%(ext)s"));
    // Hold a global concurrency slot only for the expensive extraction/merge,
    // so cache hits and coalesced waiters never occupy a slot.
    await withDownloadSlot(() => runDownloadProcess(args));

    const entries = await readdir(dir);
    const fileName = entries.find((e) => e.startsWith("media."));
    if (!fileName) {
      throw new YtDlpError("no output produced", "DOWNLOAD_FAILED");
    }
    await moveFile(join(dir, fileName), finalPath);
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

/**
 * Prepares a download. Identical (url, format, kind) requests are de-duplicated
 * via the download cache: the first request produces the file once, and every
 * concurrent/subsequent request is served straight from disk (near-instant).
 */
export async function prepareDownload(
  url: string,
  formatId: string,
  kind: MediaKind,
): Promise<DownloadResult> {
  // The real output template is set per-production inside produceTo; this
  // placeholder is only here so buildDownloadArgs can return args/ext/type.
  const { args, ext, contentType } = buildDownloadArgs(
    url,
    formatId,
    kind,
    "media.%(ext)s",
  );

  const key = createHash("sha256")
    .update(`${url}|${formatId}|${kind}`)
    .digest("hex")
    .slice(0, 40);

  return getOrProduce(key, ext, contentType, (finalPath) =>
    produceTo(args, finalPath),
  );
}
