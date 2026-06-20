import { NextResponse } from "next/server";

import { getMetadata } from "@/server/extractors";
import { metadataLimiter, clientId } from "@/lib/rate-limit";
import { metadataRequestSchema } from "@/lib/validation";
import {
  hasWorker,
  proxyToWorker,
  rejectIfUnauthorizedWorker,
} from "@/lib/worker";
import { YtDlpError } from "@/server/services/ytdlp-service";
import type { ApiError } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: string, code: ApiError["code"], status: number) {
  return NextResponse.json<ApiError>({ error, code }, { status });
}

export async function POST(request: Request) {
  const unauthorized = rejectIfUnauthorizedWorker(request);
  if (unauthorized) return unauthorized;

  const id = clientId(request.headers);
  const { success, reset } = await metadataLimiter.limit(id);
  if (!success) {
    return NextResponse.json<ApiError>(
      { error: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request body.", "INVALID_URL", 400);
  }

  const parsed = metadataRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Invalid URL.",
      "INVALID_URL",
      400,
    );
  }

  // Frontend role: the worker has yt-dlp for fallback extraction.
  if (hasWorker) {
    try {
      return await proxyToWorker("/api/metadata", parsed.data, id);
    } catch {
      return fail("Extraction service is unavailable.", "INTERNAL", 502);
    }
  }

  try {
    const data = await getMetadata(parsed.data.url);
    if (data.formats.length === 0) {
      return fail("No downloadable media found at that link.", "EXTRACTION_FAILED", 422);
    }
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof YtDlpError) {
      if (err.code === "TIMEOUT") {
        return fail("The site took too long to respond.", "TIMEOUT", 504);
      }
      if (err.code === "NOT_INSTALLED") {
        return fail("Downloader is temporarily unavailable.", "INTERNAL", 503);
      }
      return fail(
        "We couldn't extract this link. It may be private, removed, or unsupported.",
        "EXTRACTION_FAILED",
        422,
      );
    }
    return fail("Something went wrong.", "INTERNAL", 500);
  }
}
