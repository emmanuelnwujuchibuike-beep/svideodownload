import { NextResponse } from "next/server";

import { checkDownloadQuota, isInternalWorkerCall } from "@/lib/api/download-quota";
import { BusyError } from "@/lib/concurrency";
import { downloadLimiter, clientId } from "@/lib/rate-limit";
import { slugifyFilename } from "@/lib/utils";
import { downloadRequestSchema, type DownloadRequest } from "@/lib/validation";
import {
  hasWorker,
  proxyToWorker,
  rejectIfUnauthorizedWorker,
} from "@/lib/worker";
import { recordDownloadEvent } from "@/server/services/analytics";
import { resolveDownload } from "@/server/services/download-service";
import { YtDlpError } from "@/server/services/ytdlp-service";
import type { ApiError } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel caps serverless function duration at the plan maximum (300s on Hobby).
// On the Docker worker there is no ceiling and this hint is ignored.
export const maxDuration = 300;

function fail(error: string, code: ApiError["code"], status: number) {
  return NextResponse.json<ApiError>({ error, code }, { status });
}

/**
 * Enforces the per-plan DAILY download cap for genuine end-user requests.
 * Returns a 429 response when the cap is hit, or null to proceed. Internal
 * worker-proxied calls are skipped (the frontend already counted them).
 */
async function enforceDailyCap(
  request: Request,
  clientIp: string,
): Promise<Response | null> {
  if (isInternalWorkerCall(request)) return null;
  const quota = await checkDownloadQuota(request, clientIp);
  if (quota.allowed) return null;
  return NextResponse.json<ApiError>(
    {
      error:
        quota.plan === "free"
          ? `Daily download limit reached (${quota.limit}/day). Sign up or upgrade for more.`
          : `Daily download limit reached (${quota.limit}/day on the ${quota.plan} plan).`,
      code: "RATE_LIMITED",
    },
    { status: 429, headers: { "Retry-After": "3600" } },
  );
}

/** Shared core: rate-limit, proxy-or-resolve, stream the file as an attachment. */
async function processDownload(
  data: DownloadRequest,
  clientIp: string,
): Promise<Response> {
  const { success, reset } = await downloadLimiter.limit(clientIp);
  if (!success) {
    return NextResponse.json<ApiError>(
      { error: "Too many downloads. Please wait a moment.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) } },
    );
  }

  // Record the download for admin stats (best-effort, fire-and-forget).
  recordDownloadEvent(data.url, data.kind, data.title);

  // Frontend role: forward the heavy work to the worker (which has yt-dlp/ffmpeg).
  if (hasWorker) {
    try {
      return await proxyToWorker("/api/download", data, clientIp);
    } catch {
      return fail("Download service is unavailable.", "INTERNAL", 502);
    }
  }

  const { url, formatId, kind, title: providedTitle } = data;

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

/** Programmatic JSON download (used by background fetches). */
export async function POST(request: Request) {
  const unauthorized = rejectIfUnauthorizedWorker(request);
  if (unauthorized) return unauthorized;

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

  const clientIp = clientId(request.headers);
  const capped = await enforceDailyCap(request, clientIp);
  if (capped) return capped;

  return processDownload(parsed.data, clientIp);
}

/**
 * Browser-navigable download. The client points a link at this URL so the
 * browser saves the file via its NATIVE download manager — essential on iOS
 * Safari, where programmatic blob downloads are silently ignored.
 */
export async function GET(request: Request) {
  const unauthorized = rejectIfUnauthorizedWorker(request);
  if (unauthorized) return unauthorized;

  const sp = new URL(request.url).searchParams;
  const parsed = downloadRequestSchema.safeParse({
    url: sp.get("url") ?? undefined,
    formatId: sp.get("formatId") ?? undefined,
    kind: sp.get("kind") ?? "video",
    title: sp.get("title") ?? undefined,
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request.", "INVALID_URL", 400);
  }

  const clientIp = clientId(request.headers);
  const capped = await enforceDailyCap(request, clientIp);
  if (capped) return capped;

  return processDownload(parsed.data, clientIp);
}
