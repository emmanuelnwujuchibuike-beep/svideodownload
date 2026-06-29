import { NextResponse } from "next/server";
import { z } from "zod";

import { storePostMedia } from "@/server/services/store-media-service";
import { WORKER_SECRET } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// On the worker there's no real ceiling; this hint applies only if Vercel ever runs it.
export const maxDuration = 300;

const schema = z.object({
  postId: z.string().uuid(),
  uid: z.string().uuid(),
  url: z.string().url().max(2048),
  formatId: z.string().min(1).max(64),
  kind: z.enum(["video", "audio", "image"]),
  title: z.string().max(300).default("video"),
});

/**
 * POST /api/internal/store-media — WORKER-only. Downloads + uploads a post's
 * media to storage (no serverless memory limit on the worker). Protected by the
 * shared worker secret so only the trusted frontend can invoke it.
 */
export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid input." }, { status: 400 });

  const result = await storePostMedia(parsed.data);
  return NextResponse.json(result, { status: result.ok ? 200 : result.tooLarge ? 200 : 500 });
}
