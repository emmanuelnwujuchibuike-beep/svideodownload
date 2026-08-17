import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { getCachedMetadata, getMetadata } from "@/server/extractors";
import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

import { getOrProduce, type DownloadResult } from "./download-cache";
import { downloadTelegramMedia, downloadTelegramStream } from "./telegram-mtproto";
import { prepareDownload, YtDlpError } from "./ytdlp-service";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * Orchestrates a download: prefers the fast direct-CDN proxy path produced by a
 * custom extractor, and falls back to the yt-dlp pipeline otherwise.
 */

const PROXY_TIMEOUT_MS = Number(process.env.PROXY_DOWNLOAD_TIMEOUT_MS || 20_000);

/*
  🔴 Every ffmpeg child process below (the codec probe, the H.264 transcode,
  the downscale) previously had NO execution timeout at all — unlike every
  yt-dlp subprocess in ytdlp-service.ts, which has always had one (see
  `runYtDlp`'s hard timeout, `runDownloadProcess`'s idle timeout). If the
  source CDN throttled or stalled mid-stream — exactly what a datacenter IP
  hitting TikTok/Facebook/Instagram can trigger — ffmpeg would simply hang,
  and the request never resolved: no error, no fallback, nothing shown beyond
  "Preparing... this is taking longer than expected" forever (owner,
  2026-08-16: "high top two quality video download still glitches, it doesnt
  download"). TikTok's top-ranked formats are the ones most likely to hit
  this path (needsCodecCheck below), since its own bitrate tiers don't expose
  a trustworthy codec and are routed through the probe/transcode either way.

  Both timers are IDLE timeouts (reset on every chunk of ffmpeg output), the
  same shape as `runDownloadProcess`'s: a genuinely long transcode keeps
  succeeding as long as it's making progress, and only a stream that's
  actually stopped moving gets killed. Once ffmpeg can fail fast instead of
  hanging forever, `resolveDownload`'s own existing fallback chain (yt-dlp,
  then a rescue H.264 stream) actually gets a chance to run.
*/
const FFMPEG_PROBE_TIMEOUT_MS = Number(process.env.FFMPEG_PROBE_TIMEOUT_MS || 10_000);
const FFMPEG_IDLE_TIMEOUT_MS = Number(process.env.FFMPEG_IDLE_TIMEOUT_MS || 120_000);

/*
  🔴 The raw-proxy path had the SAME class of bug as the ffmpeg spawns above,
  in a different shape (owner, 2026-08-16: "download on tiktok loads
  forever"). `PROXY_TIMEOUT_MS` only bounds the wait for `fetch()` to
  RESOLVE — which happens the moment response HEADERS arrive, not when the
  body finishes. `proxyDownload` then handed `res.body` straight back as the
  stream Next.js pipes to the browser, with nothing watching it afterward. A
  source that starts responding (headers arrive fine) and then stalls or
  throttles mid-body — the exact behavior a datacenter IP can trigger — hung
  forever with the timeout already spent and gone. This is very likely the
  DOMINANT path for TikTok specifically now: the H.264-first format ordering
  (see tiktok.ts) means most TikTok downloads probe as h264 and take this
  exact raw-proxy route rather than the ffmpeg transcode path above.
*/
const PROXY_STREAM_IDLE_TIMEOUT_MS = Number(process.env.PROXY_STREAM_IDLE_TIMEOUT_MS || 30_000);

/**
 * Wraps a body stream so a source that stops sending bytes errors out after
 * `idleMs` of silence, instead of the response staying open indefinitely.
 * Idle, not a hard wall — reset on every chunk — so a large, healthy,
 * continuously-flowing file is never cut off.
 */
function withIdleTimeout(stream: ReadableStream<Uint8Array>, idleMs: number): ReadableStream<Uint8Array> {
  let timer: NodeJS.Timeout;
  const stalled = () => new YtDlpError("download stalled", "TIMEOUT");
  const ts = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      timer = setTimeout(() => controller.error(stalled()), idleMs);
    },
    transform(chunk, controller) {
      clearTimeout(timer);
      controller.enqueue(chunk);
      timer = setTimeout(() => controller.error(stalled()), idleMs);
    },
    flush() {
      clearTimeout(timer);
    },
  });
  // Errors surfaced via controller.error() above already propagate to the
  // readable side (what the caller consumes); this catch only exists so a
  // source-stream failure (not our timeout) doesn't become an unhandled
  // rejection — pipeTo cancels the source reader either way.
  stream.pipeTo(ts.writable).catch(() => clearTimeout(timer));
  return ts.readable;
}

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
    stream: withIdleTimeout(res.body as ReadableStream<Uint8Array>, PROXY_STREAM_IDLE_TIMEOUT_MS),
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

/**
 * Codec probes, memoised per direct URL (owner, carried over from 2026-08-09:
 * "probe+cache per directUrl").
 *
 * ── What this actually saves ─────────────────────────────────────────────────
 * The probe spawns ffmpeg and opens a network connection to the CDN to read a
 * container header. That is fast, but it is not free, and it was being paid
 * more than once for the same bytes in three real situations:
 *
 *   • the fast path probes, decides the stream is NOT H.264, and hands the
 *     codec to `transcodeToH264` — which is already threaded through, but any
 *     other caller re-probes;
 *   • a retry (the client retries up to 3 times) re-probes the same URL;
 *   • a batch — every photo/clip of one post — probes siblings back-to-back.
 *
 * ── Why the TTL is short ─────────────────────────────────────────────────────
 * These URLs are signed and expire, and a stale "h264" answer for a URL that has
 * since died is harmless (the fetch fails and falls through to the validated
 * path) but a stale answer that outlives a URL's replacement is pointless. Ten
 * minutes comfortably covers a retry storm and a batch without pretending to be
 * a persistent cache.
 *
 * Bounded so a long-running worker cannot grow this without limit.
 */
const CODEC_TTL_MS = 10 * 60_000;
const CODEC_CACHE_MAX = 500;
const codecCache = new Map<string, { codec: string | null; at: number }>();

function cachedCodec(url: string): string | null | undefined {
  const hit = codecCache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CODEC_TTL_MS) {
    codecCache.delete(url);
    return undefined;
  }
  return hit.codec;
}

function rememberCodec(url: string, codec: string | null): void {
  codecCache.set(url, { codec, at: Date.now() });
  // Oldest-first eviction — Map preserves insertion order.
  while (codecCache.size > CODEC_CACHE_MAX) {
    const oldest = codecCache.keys().next().value;
    if (oldest === undefined) break;
    codecCache.delete(oldest);
  }
}

/** Probes a remote URL's video codec via ffmpeg (always available). Memoised. */
async function probeUrlCodec(format: MediaFormat): Promise<string | null> {
  const url = format.directUrl;
  if (url) {
    const hit = cachedCodec(url);
    if (hit !== undefined) return hit;
  }
  const codec = await runCodecProbe(format);
  if (url) rememberCodec(url, codec);
  return codec;
}

function runCodecProbe(format: MediaFormat): Promise<string | null> {
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
    let settled = false;
    // A container-header probe reads a few KB and should finish in well under
    // a second — a stalled/throttled source is treated the same as "codec
    // unknown" (null), which routes the caller to the safe, validated
    // transcode path rather than hanging the whole download.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve(null);
    }, FFMPEG_PROBE_TIMEOUT_MS);
    child.stderr?.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const m = err.match(/Video:\s*([a-z0-9]+)/i);
      resolve(m ? m[1]!.toLowerCase() : null);
    });
  });
}

async function transcodeToH264(format: MediaFormat, knownCodec?: string | null): Promise<DownloadResult> {
  const key = createHash("sha256")
    .update(`vh264|${format.directUrl}`)
    .digest("hex")
    .slice(0, 40);

  // The caller has usually just probed to decide whether it could stream the
  // source raw; re-probing here would spend a second network round-trip to
  // learn the same thing.
  const codec = (knownCodec ?? (await probeUrlCodec(format)))?.toLowerCase();
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
        // A VIDEO stream is mandatory — without this, an audio-only source
        // "succeeds" and ships an audio-only mp4 the user saved as a video.
        // Requiring 0:v:0 makes that impossible; audio stays optional.
        "-map", "0:v:0",
        "-map", "0:a:0?",
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
      let settled = false;
      // Idle timeout, not a hard wall — see the module-level note on
      // FFMPEG_IDLE_TIMEOUT_MS. Reset on every stderr chunk, which ffmpeg
      // emits continuously (its own progress line) while actively encoding;
      // only a source that's genuinely stopped advancing gets killed.
      let idleTimer: NodeJS.Timeout;
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          reject(new YtDlpError("transcode stalled", "TIMEOUT"));
        }, FFMPEG_IDLE_TIMEOUT_MS);
      };
      resetIdle();
      child.stderr.on("data", (c: Buffer) => {
        if (err.length < 2000) err += c.toString();
        resetIdle();
      });
      child.on("error", (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        reject(new YtDlpError(e.message, "DOWNLOAD_FAILED"));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        if (code === 0) resolve();
        else reject(new YtDlpError(`transcode failed: ${err.slice(-300)}`, "DOWNLOAD_FAILED"));
      });
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
        // Video stream required (see transcodeToH264) — audio-only can't pass.
        "-map", "0:v:0",
        "-map", "0:a:0?",
        // Never scale UP — only clamps a source that's already taller than
        // maxHeight. NOTE: no shell is involved (spawn takes argv directly),
        // so this is ffmpeg's OWN filtergraph syntax, not shell quoting —
        // quotes here would be passed through literally as part of the value
        // (which is what silently broke this before: ffmpeg failed to parse
        // the filter and produced a near-empty file rather than a real
        // video). ffmpeg needs the comma inside min(...) escaped with a
        // backslash because a bare comma chains to a NEW filter.
        "-vf", `scale=-2:min(${maxHeight}\\,ih)`,
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
      let settled = false;
      // Same idle-timeout shape as transcodeToH264 above.
      let idleTimer: NodeJS.Timeout;
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          reject(new YtDlpError("downscale stalled", "TIMEOUT"));
        }, FFMPEG_IDLE_TIMEOUT_MS);
      };
      resetIdle();
      child.stderr.on("data", (c: Buffer) => {
        if (err.length < 2000) err += c.toString();
        resetIdle();
      });
      child.on("error", (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        reject(new YtDlpError(e.message, "DOWNLOAD_FAILED"));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        if (code === 0) resolve();
        else reject(new YtDlpError(`downscale failed: ${err.slice(-300)}`, "DOWNLOAD_FAILED"));
      });
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

  // Authenticated Telegram (private / Story) media has no public URL to proxy and
  // yt-dlp can't reach it — download it through the worker's MTProto client.
  // STREAM it so the browser gets bytes + progress immediately (no long "preparing"
  // wait); fall back to the buffered, cached path if the stream can't be set up.
  if (format?.telegramRef) {
    const ref = format.telegramRef;
    try {
      return { ...(await downloadTelegramStream(ref)), title };
    } catch {
      const key = createHash("sha256").update(`tg|${JSON.stringify(ref)}|${format.ext}`).digest("hex").slice(0, 40);
      const result = await getOrProduce(key, format.ext, contentTypeFor(format.ext), (finalPath) =>
        downloadTelegramMedia(ref, finalPath),
      );
      return { ...result, title };
    }
  }

  const hasDirect = !!format?.directUrl && format.kind === kind;

  // A synthesized lower-quality tier (see quality-ladder.ts) always goes
  // through ffmpeg to actually produce a smaller file — which also validates
  // the source: a source with no real video track fails loudly here instead
  // of silently shipping an audio-only "video" the way a raw proxy would. No
  // fallback to the raw stream — that would defeat the entire point.
  if (hasDirect && format!.transcodeMaxHeight) {
    return { ...(await downscaleTo(format!, format!.transcodeMaxHeight)), title };
  }

  // Platforms whose direct-URL video streams aren't reliably H.264 — the only
  // codec guaranteed to decode as VIDEO in every browser — are always probed
  // and normalized via ffmpeg instead of proxied raw. Facebook/Instagram/
  // Threads commonly serve VP9; TikTok's own bitrate tiers don't expose a
  // trustworthy codec field (see buildFormats) and its "highest quality"/HD
  // tier is sometimes a proprietary codec that plays as audio-only with no
  // picture. Other direct-URL platforms (X/Pinterest/Vimeo/Snapchat) have
  // always been observed serving plain H.264 and keep the faster raw-proxy path.
  const needsCodecCheck = kind === "video" && ["facebook", "instagram", "threads", "tiktok"].includes(meta.platform);

  if (hasDirect && needsCodecCheck) {
    /*
      ── The fast path (owner, 2026-08-09: "TikTok download takes too long, I
         want it to be below 2 to 3 seconds") ─────────────────────────────────

      Every TikTok/Facebook/Instagram/Threads video went through
      `transcodeToH264`, and even in its best case — a genuine H.264 source, so
      `-c copy` with no re-encode — that still pulls the ENTIRE file to the
      worker's disk before the first byte reaches the browser. Measured on a
      7-second Facebook clip: 11.8 seconds. The transfer was never the slow
      part; waiting for a complete server-side copy was.

      The probe is what makes skipping it safe. It reads the container header
      only (a fraction of a second) and, crucially, a non-null result comes from
      ffmpeg's own `Video: <codec>` line — so "h264" is positive proof that a
      real video stream exists. That is exactly the assurance the transcode was
      standing in for, which is why proxying raw here does NOT reintroduce the
      audio-only bug: the old raw path was unvalidated, and this one is not.

      So: genuine H.264 streams straight through and starts immediately;
      anything else (HEVC, TikTok's bytevc1, a source with no video track at
      all) still goes the long way round and is re-encoded.
    */
    const probed = (await probeUrlCodec(format!))?.toLowerCase() ?? null;
    if (probed === "h264") {
      try {
        return { ...(await proxyDownload(format!)), title };
      } catch {
        // The direct URL died between the probe and the fetch — fall through to
        // the validated path rather than failing the download.
      }
    }

    try {
      return { ...(await transcodeToH264(format!, probed)), title };
    } catch (e) {
      // NEVER fall back to the raw, unvalidated stream here — that's exactly
      // what would silently reintroduce the audio-only bug this check exists
      // to catch. Try yt-dlp's own independent extraction as a second
      // opinion; if that also fails, try the platform's OTHER direct stream
      // (TikTok's TikWM fallback exposes an HD bytevc1/H.265 stream AND a
      // plain H.264 one — when the HD transcode fails and TikTok blocks
      // yt-dlp, the H.264 stream still yields a real, playable video). Only
      // when every validated path fails do we surface an error instead of a
      // "successful" download that's secretly broken.
      try {
        return { ...(await prepareDownload(url, formatId, kind)), title };
      } catch {
        const rescue =
          meta.formats.find(
            (f) => f.kind === "video" && !!f.directUrl && f.directUrl !== format!.directUrl && f.vcodec === "h264",
          ) ??
          meta.formats.find(
            (f) => f.kind === "video" && !!f.directUrl && f.directUrl !== format!.directUrl,
          );
        if (rescue) {
          try {
            // transcodeToH264 probes first: genuine H.264 is remuxed (fast),
            // anything else is re-encoded — never proxied unvalidated.
            return { ...(await transcodeToH264(rescue)), title };
          } catch {
            /* fall through to the original error */
          }
        }
        throw e instanceof YtDlpError ? e : new YtDlpError("could not produce a playable video", "DOWNLOAD_FAILED");
      }
    }
  }

  if (hasDirect) {
    try {
      return { ...(await proxyDownload(format!)), title };
    } catch {
      // Direct URL expired/blocked — fall through to yt-dlp.
    }
  }

  // yt-dlp pipeline (no direct URL, or the direct proxy above failed).
  // produceTo guarantees H.264.
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

    /*
      🔴 A quality rung that does not exist must not be a dead end (owner,
      2026-08-09: "this Facebook link is showing error 502").

      Reproduced exactly: for that post yt-dlp advertised 2160p, 1440p, 1080p
      and 720p; 2160p returned 502 while 1080p and 720p returned the same file,
      byte for byte. yt-dlp lists what the platform's manifest CLAIMS, and
      Facebook's manifest claims renditions it will not serve — so the top of
      the list, which is what anyone picks, was the one guaranteed to fail.

      We cannot know which rungs are real without trying them, so the honest
      behaviour is to try another rather than hand back an error for a video
      that is plainly downloadable. One retry, at the platform's own best
      available format: the visitor gets the file, at a resolution that exists,
      instead of a 502 for one that never did.
    */
    if (kind === "video" && formatId !== "best") {
      try {
        return { ...(await prepareDownload(url, "best", kind)), title };
      } catch {
        /* the whole video is genuinely unavailable — report the real error */
      }
    }
    throw err;
  }
}
