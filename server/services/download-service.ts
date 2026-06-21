import { getCachedMetadata, getMetadata } from "@/server/extractors";
import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

import type { DownloadResult } from "./download-cache";
import { prepareDownload, YtDlpError } from "./ytdlp-service";

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

  // Facebook's direct URLs are frequently VP9 (which plays as audio-only on
  // iOS), so for video we try yt-dlp's H.264 selector FIRST and only use the
  // direct URL if yt-dlp can't extract it.
  const preferYtdlp = meta.platform === "facebook" && kind === "video";

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
      return { ...(await proxyDownload(format!)), title };
    }
    throw err;
  }
}
