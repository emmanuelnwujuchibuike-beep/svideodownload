import { NextResponse } from "next/server";

import { cacheBackend } from "@/lib/cache";
import { downloadConcurrencyStats } from "@/lib/concurrency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "svideodownload",
    time: new Date().toISOString(),
    cache: cacheBackend,
    downloads: downloadConcurrencyStats(),
  });
}
