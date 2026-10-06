import { NextResponse } from "next/server";

import { BusyError } from "@/lib/concurrency";
import { isTooLarge, maxDownloadBytes, tooLargeMessage } from "@/lib/downloads/size-cap";
import { slugifyFilename } from "@/lib/utils";
import type { DownloadRequest } from "@/lib/validation";
import { resolveDownload } from "@/server/services/download-service";
import { YtDlpError } from "@/server/services/ytdlp-service";
import type { ApiError } from "@/types";

/**
 * Resolve one authorised download and stream it as an attachment — the part
 * that runs where yt-dlp/ffmpeg live (the worker role).
 *
 * Shared by `/api/download` (reached through the Vercel proxy, or locally)
 * and `/api/download/direct` (reached by the browser with a signed ticket),
 * so the two doors cannot drift apart in what they stream or how they fail.
 * Callers have already done every check that decides WHETHER to download.
 */
export async function streamResolvedDownload(
  data: DownloadRequest,
  clientPlaysHevc: boolean,
  extraHeaders: Record<string, string> = {},
  /** The caller's size cap — Infinity for paid plans (lib/downloads/size-cap.ts). */
  maxBytes: number = maxDownloadBytes(),
): Promise<Response> {
  const { url, formatId, kind, title: providedTitle } = data;
  const fail = (error: string, code: ApiError["code"], status: number, more: Record<string, string> = {}) =>
    NextResponse.json<ApiError>({ error, code }, { status, headers: { ...extraHeaders, ...more } });

  try {
    const { stream, ext, contentType, filesize, title } = await resolveDownload(
      url,
      formatId,
      kind,
      providedTitle || "video",
      { clientPlaysHevc },
    );
    /*
      🔴 Refuse BEFORE a byte is sent (lib/downloads/size-cap.ts, 2026-10-06):
      a 750 MB Telegram video cannot finish through the proxy and every retry
      re-sent it out of Railway.
    */
    if (isTooLarge(filesize, maxBytes)) {
      try {
        await stream.cancel();
      } catch {
        /* nothing was flowing */
      }
      return fail(tooLargeMessage(filesize, maxBytes), "FILE_TOO_LARGE", 413);
    }
    const filename = slugifyFilename(title, ext);

    const headers: Record<string, string> = {
      ...extraHeaders,
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    };
    if (filesize > 0) headers["Content-Length"] = String(filesize);

    return new Response(stream, { headers });
  } catch (err) {
    if (err instanceof BusyError) {
      return fail("Server is busy. Please retry in a moment.", "RATE_LIMITED", 503, { "Retry-After": "10" });
    }
    if (err instanceof YtDlpError) {
      if (err.code === "NOT_INSTALLED") {
        return fail("Downloader is temporarily unavailable.", "INTERNAL", 503);
      }
      if (err.code === "TIMEOUT") {
        return fail("The download stalled. Please try again.", "TIMEOUT", 504);
      }
    }
    // 503, not 502: Cloudflare replaces an origin 502 with its own HTML page.
    return fail("Download failed. Please try again.", "DOWNLOAD_FAILED", 503);
  }
}
