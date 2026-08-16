import { NextResponse } from "next/server";

import { checkDownloadQuota, isInternalWorkerCall } from "@/lib/api/download-quota";
import { BusyError } from "@/lib/concurrency";
import { RewardError, redeemRewardItem } from "@/lib/monetization/reward-sessions";
import { downloadLimiter, clientId } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
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
  /** The client's stable id for this download — see `checkDownloadQuota`. */
  downloadId?: string | null,
  /** The batch this file belongs to, when it belongs to one. One charge per batch. */
  batchId?: string | null,
): Promise<Response | null> {
  if (isInternalWorkerCall(request)) return null;
  const quota = await checkDownloadQuota(request, clientIp, downloadId, batchId);
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
  const clientIp = clientId(request.headers);

  /*
    Reward-gated HD/batch downloads carry a `rewardToken` (the reward session
    id) instead of a trusted `url`/`formatId`/`kind` — see
    lib/monetization/reward-sessions.ts. When present, `url`/`formatId`/`kind`/
    `title` are taken ENTIRELY from the server-stored session, never from the
    query string: that substitution is what makes it impossible to earn a
    reward for one quality/batch and redeem it against another.
  */
  const rewardToken = sp.get("rewardToken");
  let data: DownloadRequest;

  if (rewardToken) {
    const itemIndex = Number.parseInt(sp.get("itemIndex") ?? "0", 10);
    let userId: string | null = null;
    try {
      if (request.headers.get("cookie")?.includes("-auth-token")) {
        const supabase = await createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        userId = user?.id ?? null;
      }
    } catch {
      /* signed out */
    }

    try {
      const item = await redeemRewardItem({
        rewardSessionId: rewardToken,
        itemIndex: Number.isFinite(itemIndex) ? itemIndex : 0,
        userId,
        ip: clientIp,
      });
      data = { url: item.url, formatId: item.formatId, kind: item.kind, title: item.title };
    } catch (e) {
      if (e instanceof RewardError) {
        return fail(e.message, e.code, e.code === "DAILY_LIMIT_REACHED" ? 429 : 400);
      }
      return fail("Couldn't authorize this download.", "DOWNLOAD_TOKEN_EXPIRED", 400);
    }
  } else {
    const parsed = downloadRequestSchema.safeParse({
      url: sp.get("url") ?? undefined,
      formatId: sp.get("formatId") ?? undefined,
      kind: sp.get("kind") ?? "video",
      title: sp.get("title") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request.", "INVALID_URL", 400);
    }
    data = parsed.data;
  }

  /*
    `t` is the download manager's task id: stable across automatic retries of
    the SAME download, different for every new one, so a download costs one unit
    of the daily cap however many attempts it takes to deliver.

    Untrusted input, used only as part of a Redis key — length-capped and
    stripped to id characters. A caller cannot forge anyone else's receipt: the
    key it becomes is already scoped to their own user id or IP.
  */
  const downloadId = (sp.get("t") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || null;
  /*
    `b` — the batch this file belongs to. Sanitised identically to `t` and for
    the same reason: it is untrusted input used only as part of a Redis key,
    and the key it becomes is already scoped to the caller's own user id or IP,
    so a forged value can only ever collide with themselves.
  */
  const batchId = (sp.get("b") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || null;
  const capped = await enforceDailyCap(request, clientIp, downloadId, batchId);
  if (capped) return capped;

  return processDownload(data, clientIp);
}
