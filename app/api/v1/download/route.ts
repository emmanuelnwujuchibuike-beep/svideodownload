import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateApi } from "@/lib/api/auth";
import { recordApiUsage } from "@/lib/api/usage";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  url: z.string().url().max(2048),
  formatId: z.string().max(64).optional(),
  kind: z.enum(["video", "audio", "image"]).optional(),
});

/**
 * POST /v1/download — resolves a ready-to-use download link for a URL. Returns a
 * `download_url` the client can GET to receive the file. Auth: Bearer key.
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
  const kind = parsed.data.kind ?? "video";

  try {
    // Validate + pick a format via metadata.
    const r = await fetch(`${base}/api/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `apikey:${auth.ctx.keyId}` },
      body: JSON.stringify({ url: parsed.data.url }),
    });
    const j = await r.json();
    recordApiUsage(auth.ctx.keyId, auth.ctx.userId, "download", r.status);
    if (!r.ok || j.ok === false) {
      return NextResponse.json(
        { error: j.error ?? "Couldn't resolve that link.", code: "extraction_failed" },
        { status: 422 },
      );
    }

    const formats = (j.data.formats ?? []) as { formatId: string; kind: string }[];
    const chosen =
      parsed.data.formatId ||
      formats.find((f) => f.kind === kind)?.formatId ||
      formats[0]?.formatId ||
      "best";

    const params = new URLSearchParams({
      url: parsed.data.url,
      formatId: chosen,
      kind,
      title: (j.data.title as string) || "download",
    });
    return NextResponse.json({
      title: j.data.title,
      ext: kind === "audio" ? "mp3" : kind === "image" ? "jpg" : "mp4",
      download_url: `${base}/api/download?${params.toString()}`,
      quota: { limit: auth.ctx.limit, used: auth.ctx.used + 1, plan: auth.ctx.plan },
    });
  } catch {
    recordApiUsage(auth.ctx.keyId, auth.ctx.userId, "download", 502);
    return NextResponse.json({ error: "Download service unavailable.", code: "upstream_error" }, { status: 502 });
  }
}
