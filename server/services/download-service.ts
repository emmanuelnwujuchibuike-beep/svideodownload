import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { getCachedMetadata, getMetadata } from "@/server/extractors";
import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

import { getOrProduce, type DownloadResult } from "./download-cache";
import { prepareDownload, YtDlpError } from "./ytdlp-service";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * Orchestrates a download: prefers the fast direct-CDN proxy path produced by a
 * custom extractor, and falls back to the yt-dlp pipeline otherwise.
 */

const PROXY_TIMEOUT_MS = Number(process.env.PROXY_DOWNLOAD_TIMEOUT_MS || 20_000);

const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fc00:|\[?fe80:)/i;

function contentTypeFor(ext: string): string {
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "mp4":
      return "video/mp4";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

/** Streams a custom-extractor direct URL straight through (no yt-dlp/ffmpeg). */
async function proxyDownload(format: MediaFormat): Promise<DownloadResult> {
  const target = format.directUrl!;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new YtDlpError("invalid direct url", "DOWNLOAD_FAILED");
  }
  // Defense-in-depth: these URLs come from our own extractor, but never proxy
  // to non-https or private hosts.
  if (parsed.protocol !== "https:" || PRIVATE_HOST.test(parsed.hostname)) {
    throw new YtDlpError("blocked direct url", "DOWNLOAD_FAILED");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      headers: format.httpHeaders ?? {},
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok || !res.body) {
    throw new YtDlpError(`proxy responded ${res.status}`, "DOWNLOAD_FAILED");
  }

  // Defensive, zero-cost check: a "video" request whose source unexpectedly
  // serves an audio container must never be silently accepted as a working
  // download — better to throw here (the caller falls back to yt-dlp) than
  // save a file that plays with no picture.
  const contentType = res.headers.get("content-type") || "";
  if (format.kind === "video" && /^audio\//i.test(contentType)) {
    throw new YtDlpError("source served audio-only content for a video request", "DOWNLOAD_FAILED");
  }

  return {
    stream: res.body as ReadableStream<Uint8Array>,
    ext: format.ext,
    contentType: contentTypeFor(format.ext),
    filesize: Number(res.headers.get("content-length")) || 0,
  };
}

/**
 * Transcodes a direct CDN URL to H.264/AAC MP4 with ffmpeg. Used for the
 * Facebook/Instagram fallback, whose direct streams are often VP9 (audio-only
 * on iOS). Already-H.264 streams are remuxed (fast, no quality loss); only
 * VP9/AV1 is re-encoded. Result is cached so a clip is only processed once.
 */
function headerArgFor(format: MediaFormat): string[] {
  if (!format.httpHeaders) return [];
  const h = Object.entries(format.httpHeaders)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  return h ? ["-headers", h] : [];
}

/** Probes a remote URL's video codec via ffmpeg (always available). */
function probeUrlCodec(format: MediaFormat): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        FFMPEG,
        [...headerArgFor(format), "-hide_banner", "-i", format.directUrl!],
        { windowsHide: true },
      );
    } catch {
      resolve(null);
      return;
    }
    let err = "";
    child.stderr?.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const m = err.match(/Video:\s*([a-z0-9]+)/i);
      resolve(m ? m[1]!.toLowerCase() : null);
    });
  });
}

async function transcodeToH264(format: MediaFormat): Promise<DownloadResult> {
  const key = createHash("sha256")
    .update(`vh264|${format.directUrl}`)
    .digest("hex")
    .slice(0, 40);

  const codec = (await probeUrlCodec(format))?.toLowerCase();
  // Only a genuine H.264 stream is guaranteed to decode as VIDEO in every
  // browser — remux it as-is (fast, no quality loss). HEVC decodes fine on
  // iOS/Safari but not reliably on Chrome/Android/Windows, and TikTok's own
  // proprietary codec (bytevc1) never does; both previously being treated as
  // "safe to copy" here let them pass straight through, which plays as
  // audio-only with no picture on those devices. Everything else is re-encoded.
  const copy = codec === "h264";
  // Cap x264 threads — it otherwise spawns one per host core and OOM-kills the
  // memory-limited worker container mid-encode (see ytdlp-service transcode).
  const threads = process.env.FFMPEG_THREADS || "2";
  const videoArgs = copy
    ? ["-c:v", "copy"]
    : [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-threads", threads,
        "-x264-params", `threads=${threads}:lookahead-threads=1`,
      ];

  return getOrProduce(key, "mp4", "video/mp4", (finalPath) =>
    new Promise<void>((resolve, reject) => {
      const args = [
        ...headerArgFor(format),
        "-threads", threads,
        "-i",
        format.directUrl!,
        ...videoArgs,
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-y",
        finalPath,
      ];
      let child;
      try {
        child = spawn(FFMPEG, args, { windowsHide: true });
      } catch {
        reject(new YtDlpError("ffmpeg not found", "DOWNLOAD_FAILED"));
        return;
      }
      let err = "";
      child.stderr.on("data", (c: Buffer) => {
        if (err.length < 2000) err += c.toString();
      });
      child.on("error", (e: Error) =>
        reject(new YtDlpError(e.message, "DOWNLOAD_FAILED")),
      );
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(
              new YtDlpError(`transcode failed: ${err.slice(-300)}`, "DOWNLOAD_FAILED"),
            ),
      );
    }),
  );
}

/**
 * Downscales+re-encodes a direct-URL source to `maxHeight` — used for the
 * synthesized lower-quality tiers (see quality-ladder.ts), so "smaller file"
 * is always a real, working, smaller video. This doubles as validation: a
 * source that lacks a real, decodable video track fails loudly here (a
 * catchable error resolveDownload falls back from) instead of silently
 * producing an audio-only file, unlike a raw proxy passthrough.
 */
async function downscaleTo(format: MediaFormat, maxHeight: number): Promise<DownloadResult> {
  const key = createHash("sha256")
    .update(`vh${maxHeight}|${format.directUrl}`)
    .digest("hex")
    .slice(0, 40);

  // Cap x264 threads — see transcodeToH264 above.
  const threads = process.env.FFMPEG_THREADS || "2";

  return getOrProduce(key, "mp4", "video/mp4", (finalPath) =>
    new Promise<void>((resolve, reject) => {
      const args = [
        ...headerArgFor(format),
        "-threads", threads,
        "-i",
        format.directUrl!,
        // Never scale UP — only clamps a source that's already taller than maxHeight.
        "-vf", `scale=-2:'min(${maxHeight},ih)'`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-threads", threads,
        "-x264-params", `threads=${threads}:lookahead-threads=1`,
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        "-y",
        finalPath,
      ];
      let child;
      try {
        child = spawn(FFMPEG, args, { windowsHide: true });
      } catch {
        reject(new YtDlpError("ffmpeg not found", "DOWNLOAD_FAILED"));
        return;
      }
      let err = "";
      child.stderr.on("data", (c: Buffer) => {
        if (err.length < 2000) err += c.toString();
      });
      child.on("error", (e: Error) => reject(new YtDlpError(e.message, "DOWNLOAD_FAILED")));
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new YtDlpError(`downscale failed: ${err.slice(-300)}`, "DOWNLOAD_FAILED")),
      );
    }),
  );
}

function findFormat(
  meta: VideoMetadata,
  formatId: string,
  kind: MediaKind,
): MediaFormat | undefined {
  return (
    meta.formats.find((f) => f.formatId === formatId) ??
    meta.formats.find((f) => f.kind === kind)
  );
}

export interface ResolvedDownload extends DownloadResult {
  title: string;
}

/**
 * Resolves a download for (url, formatId, kind). Uses cached metadata when
 * present so the common path (user just previewed the video) involves no extra
 * extraction. Returns a proxy stream for direct-URL formats, else yt-dlp.
 */
export async function resolveDownload(
  url: string,
  formatId: string,
  kind: MediaKind,
  fallbackTitle: string,
): Promise<ResolvedDownload> {
  const meta = (await getCachedMetadata(url)) ?? (await getMetadata(url));
  const title = meta.title || fallbackTitle;
  const format = findFormat(meta, formatId, kind);
  const hasDirect = !!format?.directUrl && format.kind === kind;

  // A synthesized lower-quality tier (see quality-ladder.ts) always goes
  // through ffmpeg to actually produce a smaller file — which also validates
  // the source: a source with no real video track fails loudly here instead
  // of silently shipping an audio-only "video" the way a raw proxy would.
  if (hasDirect && format!.transcodeMaxHeight) {
    try {
      return { ...(await downscaleTo(format!, format!.transcodeMaxHeight)), title };
    } catch {
      try {
        return { ...(await proxyDownload(format!)), title };
      } catch {
        throw new YtDlpError("could not produce this quality", "DOWNLOAD_FAILED");
      }
    }
  }

  // Platforms whose direct-URL video streams aren't reliably H.264 — the only
  // codec guaranteed to decode as VIDEO in every browser — are always probed
  // and normalized via ffmpeg instead of proxied raw. Facebook/Instagram/
  // Threads commonly serve VP9; TikTok's own bitrate tiers don't expose a
  // trustworthy codec field (see buildFormats) and its "highest quality"/HD
  // tier is sometimes a proprietary codec that plays as audio-only with no
  // picture. Other direct-URL platforms (X/Pinterest/Vimeo/Snapchat) have
  // always been observed serving plain H.264 and keep the faster raw-proxy path.
  const needsCodecCheck = ["facebook", "instagram", "threads", "tiktok"].includes(meta.platform);

  if (hasDirect) {
    try {
      if (kind === "video" && needsCodecCheck) {
        return { ...(await transcodeToH264(format!)), title };
      }
      return { ...(await proxyDownload(format!)), title };
    } catch {
      // Direct URL expired/blocked — fall through to yt-dlp.
    }
  }

  // yt-dlp pipeline (no direct URL, or it failed). produceTo guarantees H.264.
  try {
    return { ...(await prepareDownload(url, formatId, kind)), title };
  } catch (err) {
    if (hasDirect) {
      try {
        return { ...(await transcodeToH264(format!)), title };
      } catch {
        return { ...(await proxyDownload(format!)), title };
      }
    }
    throw err;
  }
}
