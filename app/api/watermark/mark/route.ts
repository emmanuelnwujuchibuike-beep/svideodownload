import { cleanHandle } from "@/lib/media/watermark-ticket";
import { watermarkMarkResponse } from "@/lib/media/watermark-mark";

export const runtime = "nodejs";

/**
 * GET /api/watermark/mark?h=<handle> — the download watermark as a transparent
 * PNG (lib/media/watermark-mark.tsx). The browser draws it onto a photo
 * download. Same handle → same bytes, so it caches for a year.
 */
export async function GET(request: Request) {
  const handle = cleanHandle(new URL(request.url).searchParams.get("h"));
  if (!handle) return new Response("Bad handle", { status: 400 });
  const res = watermarkMarkResponse(handle);
  res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return res;
}
