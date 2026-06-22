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

  return {
    stream: res.body as ReadableStream<Uint8Array>,
    ext: format.ext,
    contentType: contentTypeFor(format.ext),
    filesize: Number(res.headers.get("content-length")) || 0,
  };
}

/**
 * Transcodes a direct CDN URL to H.264/AAC MP4 with ffmpeg. Used for the
 * Facebook fallback, whose direct streams are often VP9 (audio-only on iOS).
 * Result is cached so a trending clip is only transcoded once.
 */
async function transcodeToH264(format: MediaFormat): Promise<DownloadResult> {
  const key = createHash("sha256")
    .update(`fbh264|${format.directUrl}`)
    .digest("hex")
    .slice(0, 40);

  const headerArg = format.httpHeaders
    ? Object.entries(format.httpHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n")
    : "";

  return getOrProduce(key, "mp4", "video/mp4", (finalPath) =>
    new Promise<void>((resolve, reject) => {
      const args = [
        ...(headerArg ? ["-headers", headerArg] : []),
        "-i",
        format.directUrl!,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
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
              new YtDlpError(
                `transcode failed: ${err.slice(-300)}`,
                "DOWNLOAD_FAILED",
              ),
            ),
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

  // Meta platforms' direct URLs can be VP9/DASH (audio-only or blank on iOS), so
  // for video we try yt-dlp's H.264 selector FIRST and only fall back to the
  // direct URL (transcoded to H.264) if yt-dlp can't extract it.
  const preferYtdlp =
    ["facebook", "instagram", "threads"].includes(meta.platform) &&
    kind === "video";

  // Fast path: a custom extractor gave us a direct CDN URL for the exact kind
  // requested — unless we're preferring yt-dlp for codec-compatibility reasons.
  if (hasDirect && !preferYtdlp) {
    try {
      return { ...(await proxyDownload(format!)), title };
    } catch {
      // Direct URL expired/blocked — fall through to yt-dlp.
    }
  }

  // Main path: yt-dlp pipeline (H.264-preferring; handles every other platform).
  try {
    return { ...(await prepareDownload(url, formatId, kind)), title };
  } catch (err) {
    // yt-dlp couldn't handle it — use the direct URL as a last resort.
    if (hasDirect) {
      // Facebook direct URLs are often VP9 (audio-only on iOS) → transcode to
      // H.264 so the file plays everywhere. Other platforms stream as-is.
      if (preferYtdlp) {
        try {
          return { ...(await transcodeToH264(format!)), title };
        } catch {
          /* transcode unavailable/failed — stream the original as a last resort */
        }
      }
      return { ...(await proxyDownload(format!)), title };
    }
    throw err;
  }
}
