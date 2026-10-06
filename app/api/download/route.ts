import { NextResponse } from "next/server";

import { checkDownloadQuota, isInternalWorkerCall } from "@/lib/api/download-quota";
import { capForDownload, capFromHeader, capToHeader, MAX_BYTES_HEADER, maxDownloadBytes, maxDownloadBytesFor } from "@/lib/downloads/size-cap";
import { directDownloadsEnabled, directWorkerBase, mintDirectTicket } from "@/lib/downloads/direct-ticket";
import { RewardError, redeemRewardItem } from "@/lib/monetization/reward-sessions";
import { downloadLimiter, clientId } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { downloadRequestSchema, type DownloadRequest } from "@/lib/validation";
import {
  hasWorker,
  proxyToWorker,
  rejectIfUnauthorizedWorker,
  WORKER_SECRET,
} from "@/lib/worker";
import { recordDownloadEvent } from "@/server/services/analytics";
import { streamResolvedDownload } from "@/server/services/download-response";
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
  /** What is being downloaded — binds the retry receipt to it (2026-10-06). */
  data?: DownloadRequest,
): Promise<{ denied: Response | null; maxBytes: number }> {
  /*
    The worker learns the caller's size cap from the trusted proxy (it carries
    the worker secret); without the header it applies the free cap.
  */
  if (isInternalWorkerCall(request)) return { denied: null, maxBytes: capFromHeader(request.headers.get(MAX_BYTES_HEADER)) };
  const subject = data ? `${data.url}|${data.formatId}|${data.kind}` : null;
  const quota = await checkDownloadQuota(request, clientIp, downloadId, batchId, subject);
  // Owner, 2026-10-06: files of 200 MB and over are for Pro / Business only.
  // …and a Telegram source streamed through Vercel has a ceiling set by what can finish in 300 s.
  const maxBytes = data
    ? capForDownload(quota.plan, data.url, hasWorker && !directDownloadsEnabled())
    : maxDownloadBytesFor(quota.plan);
  if (quota.allowed) return { denied: null, maxBytes };
  const denied = NextResponse.json<ApiError>(
    {
      error:
        quota.plan === "free"
          ? `Daily download limit reached (${quota.limit}/day). Sign up or upgrade for more.`
          : `Daily download limit reached (${quota.limit}/day on the ${quota.plan} plan).`,
      code: "RATE_LIMITED",
    },
    { status: 429, headers: { "Retry-After": "3600" } },
  );
  return { denied, maxBytes };
}

/** Shared core: rate-limit, proxy-or-resolve, stream the file as an attachment. */
async function processDownload(
  data: DownloadRequest,
  clientIp: string,
  /*
    Whether the CLIENT can decode HEVC (lib/media/hevc-support.ts). Threaded
    through as a plain flag rather than read from the Request here, because both
    entry points below already have the request and this function does not.
    Only ever WIDENS what may be streamed raw, and only for HEVC.
  */
  clientPlaysHevc = false,
  /*
    The caller asked for a TICKET instead of the bytes (`direct=1`, sent only
    by the download manager, which knows how to use one). Honoured only when
    the switch is on — see lib/downloads/direct-ticket.ts.
  */
  wantsDirect = false,
  /** The caller's size cap (lib/downloads/size-cap.ts) — Infinity for paid plans. */
  maxBytes: number = maxDownloadBytes(),
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
    /*
      🔴 FOT brief (owner, 2026-10-06): every check above has run — rate limit,
      and in the callers the daily quota and reward redemption. What is left is
      only moving bytes, which Vercel adds nothing to. Hand the browser a signed
      ticket and let it fetch from the worker itself.
    */
    if (wantsDirect && directDownloadsEnabled()) {
      const { ticket, expiresAt } = mintDirectTicket({ data, hevc: clientPlaysHevc, ip: clientIp, maxBytes: capToHeader(maxBytes) }, WORKER_SECRET);
      return NextResponse.json(
        { url: `${directWorkerBase()}/api/download/direct?ticket=${encodeURIComponent(ticket)}`, expiresAt },
        { headers: { "Cache-Control": "no-store", "x-frenz-direct": "1" } },
      );
    }
    try {
      return await proxyToWorker("/api/download", data, clientIp, { maxBytes });
    } catch {
      /*
        🔴 503, NOT 502 — Cloudflare REPLACES a 502 from the origin with its own
        HTML "502: Bad gateway" page, so this JSON never reached the browser and
        the download card could not show its own failure copy. 503 passes
        through, which is what makes the sentence above visible at all.
        (The same rule is why `NOT_INSTALLED` answers 503 in download-response.ts.)
      */
      return fail("Download service is unavailable.", "INTERNAL", 503);
    }
  }

  return streamResolvedDownload(data, clientPlaysHevc, {}, maxBytes);
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
  const { denied, maxBytes } = await enforceDailyCap(request, clientIp, null, null, parsed.data);
  if (denied) return denied;

  return processDownload(parsed.data, clientIp, new URL(request.url).searchParams.get("hevc") === "1", false, maxBytes);
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
  const { denied, maxBytes } = await enforceDailyCap(request, clientIp, downloadId, batchId, data);
  if (denied) return denied;

  return processDownload(data, clientIp, sp.get("hevc") === "1", sp.get("direct") === "1", maxBytes);
}
