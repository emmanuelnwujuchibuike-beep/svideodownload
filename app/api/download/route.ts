import { NextResponse } from "next/server";

import { BusyError } from "@/lib/concurrency";
import { downloadLimiter, clientId } from "@/lib/rate-limit";
import { slugifyFilename } from "@/lib/utils";
import { downloadRequestSchema } from "@/lib/validation";
import {
  hasWorker,
  proxyToWorker,
  rejectIfUnauthorizedWorker,
} from "@/lib/worker";
import { resolveDownload } from "@/server/services/download-service";
import { YtDlpError } from "@/server/services/ytdlp-service";
import type { ApiError } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps serverless function duration at the plan maximum (300s on Hobby),
// and rejects higher values at build time. On self-hosted Node (Docker / the
// worker) there is NO ceiling and this hint is ignored. So: keep it within the
// Hobby limit here, and run long/full-length downloads on the Docker worker,
// which the Vercel frontend proxies to.
export const maxDuration = 300;

function fail(error: string, code: ApiError["code"], status: number) {
  return NextResponse.json<ApiError>({ error, code }, { status });
}

export async function POST(request: Request) {
  // Worker role: reject requests without the shared secret (when configured).
  const unauthorized = rejectIfUnauthorizedWorker(request);
  if (unauthorized) return unauthorized;

  const id = clientId(request.headers);
  const { success, reset } = await downloadLimiter.limit(id);
  if (!success) {
    return NextResponse.json<ApiError>(
      { error: "Too many downloads. Please wait a moment.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request body.", "INVALID_URL", 400);
  }

  const parsed = downloadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request.", "INVALID_URL", 400);
  }

  // Frontend role: forward the heavy work to the worker (which has yt-dlp/ffmpeg).
  if (hasWorker) {
    try {
      return await proxyToWorker("/api/download", parsed.data, id);
    } catch {
      return fail("Download service is unavailable.", "INTERNAL", 502);
    }
  }

  const { url, formatId, kind, title: providedTitle } = parsed.data;

  try {
    const { stream, ext, contentType, filesize, title } = await resolveDownload(
      url,
      formatId,
      kind,
      providedTitle || "video",
    );
    const filename = slugifyFilename(title, ext);

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    };
    // Only advertise a length when we actually know it (proxy streams may not).
    if (filesize > 0) headers["Content-Length"] = String(filesize);

    return new Response(stream, { headers });
  } catch (err) {
    if (err instanceof BusyError) {
      return NextResponse.json<ApiError>(
        { error: "Server is busy. Please retry in a moment.", code: "RATE_LIMITED" },
        { status: 503, headers: { "Retry-After": "10" } },
      );
    }
    if (err instanceof YtDlpError) {
      if (err.code === "NOT_INSTALLED") {
        return fail("Downloader is temporarily unavailable.", "INTERNAL", 503);
      }
      if (err.code === "TIMEOUT") {
        return fail("The download stalled. Please try again.", "TIMEOUT", 504);
      }
    }
    return fail("Download failed. Please try again.", "DOWNLOAD_FAILED", 502);
  }
}
