import { NextResponse } from "next/server";

import { probeExtraction } from "@/server/services/ytdlp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Secret-gated extraction probe. Returns a redacted yt-dlp summary (no media
 * URLs/tokens) for a given URL, direct vs proxy, so we can diagnose why a
 * platform yields zero formats. Protected by WORKER_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.WORKER_SECRET;
  if (secret && request.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });
  }
  try {
    return NextResponse.json(await probeExtraction(url));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "probe failed" },
      { status: 500 },
    );
  }
}
