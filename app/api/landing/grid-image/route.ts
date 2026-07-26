import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/landing/grid-image?url=…&name=… — stream one of the admin-configured
 * landing images back through this origin as an attachment, so a visitor can save
 * it to their device.
 *
 * ── Why a proxy at all ────────────────────────────────────────────────────────
 *
 * The images live on Supabase/R2, a different host. A cross-origin `<a download>`
 * is ignored by iOS Safari, and a cross-origin `fetch` throws wherever the storage
 * host doesn't reflect CORS for the current origin (verified fragile — see
 * /api/media/download). Same-origin removes both problems and lets us set a real
 * `Content-Disposition: attachment`.
 *
 * ── Public, but NOT an open proxy ─────────────────────────────────────────────
 *
 * The landing is public and mostly anonymous, so unlike /api/media/download this
 * needs no sign-in. The SSRF surface an unauthenticated fetch-proxy would open is
 * closed a stronger way than a host allowlist: the `url` must be EXACTLY one of the
 * images an admin set in Admin → Landing page (settings.landing). It can fetch
 * nothing else — not `169.254.169.254`, not an internal address, not another
 * bucket object — because the value has to match a stored setting first.
 */

/** Strip anything that could break out of the header or the filename. */
function safeFilename(raw: string | null, fallbackExt: string): string {
  const cleaned = (raw ?? "")
    .replace(/[\r\n"\\]/g, "")
    .replace(/[/\\?%*:|<>]/g, "-")
    .trim()
    .slice(0, 120);
  return cleaned || `frenz-${Date.now()}.${fallbackExt}`;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("url");
  if (!raw) return NextResponse.json({ error: "Missing url." }, { status: 400 });

  // The only URLs this may fetch are the images an admin actually set. This is the
  // whole security model — no allowlist of hosts, an allowlist of exact values.
  const settings = await getLandingSettings();
  const allowed = new Set(
    [settings.reelsPosterUrl, ...settings.feedGridImages].filter((v) => v.length > 0),
  );
  if (!allowed.has(raw)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    // A root-relative asset (/brand/…) is same-origin; the client can download it
    // directly and never needs this proxy.
    return NextResponse.json({ error: "Not a remote file." }, { status: 400 });
  }
  if (target.protocol !== "https:") return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "Couldn't reach that file." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "That image is no longer available." },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.split("/")[1]?.split(";")[0] ?? "jpg";
  const filename = safeFilename(params.get("name"), ext);

  // Stream straight through — never buffered into function memory.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...(upstream.headers.get("content-length")
        ? { "Content-Length": upstream.headers.get("content-length")! }
        : {}),
      // These are public marketing images, so a shared cache is fine and cheap.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
