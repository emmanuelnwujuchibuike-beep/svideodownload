import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateApi } from "@/lib/api/auth";
import { recordApiUsage } from "@/lib/api/usage";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ url: z.string().url().max(2048) });

interface RawFormat {
  formatId: string;
  kind: string;
  label: string;
  ext: string;
  resolution: string | null;
  filesize: number | null;
  acodec: string | null;
}

/**
 * POST /v1/analyze — returns media metadata for a URL (no direct links; use
 * /v1/download to get a downloadable link). Auth: `Authorization: Bearer <key>`.
 */
export async function POST(request: Request) {
  const auth = await authenticateApi(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid `url` is required.", code: "bad_request" }, { status: 400 });
  }

  const base = SITE_URL || new URL(request.url).origin;
  try {
    const r = await fetch(`${base}/api/metadata`, {
      method: "POST",
      // Forward a per-key identity so the metadata rate-limit buckets per API
      // key instead of lumping every API call into one shared bucket.
      headers: { "Content-Type": "application/json", "x-forwarded-for": `apikey:${auth.ctx.keyId}` },
      body: JSON.stringify({ url: parsed.data.url }),
    });
    const j = await r.json();
    recordApiUsage(auth.ctx.keyId, auth.ctx.userId, "analyze", r.status);

    if (!r.ok || j.ok === false) {
      return NextResponse.json(
        { error: j.error ?? "Couldn't analyze that link.", code: "extraction_failed" },
        { status: r.status === 200 ? 422 : r.status },
      );
    }

    const d = j.data;
    return NextResponse.json(
      {
        url: parsed.data.url,
        platform: d.platform,
        title: d.title,
        thumbnail: d.thumbnail,
        duration: d.durationSeconds,
        creator: d.creator,
        formats: (d.formats as RawFormat[]).map((f) => ({
          formatId: f.formatId,
          kind: f.kind,
          label: f.label,
          ext: f.ext,
          resolution: f.resolution,
          filesize: f.filesize,
          hasAudio: f.acodec != null,
        })),
        quota: { limit: auth.ctx.limit, used: auth.ctx.used + 1, plan: auth.ctx.plan },
      },
      { headers: { "X-RateLimit-Limit": String(auth.ctx.limit), "X-RateLimit-Remaining": String(Math.max(0, auth.ctx.limit - auth.ctx.used - 1)) } },
    );
  } catch {
    recordApiUsage(auth.ctx.keyId, auth.ctx.userId, "analyze", 502);
    return NextResponse.json({ error: "Analysis service unavailable.", code: "upstream_error" }, { status: 502 });
  }
}
