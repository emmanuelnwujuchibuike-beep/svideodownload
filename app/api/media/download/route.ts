import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/media/download?url=…&name=… — stream one of OUR OWN media objects
 * back through this origin, as an attachment.
 *
 * Why this exists (owner, 2026-07-16: "Save to device" said "couldn't save
 * that"). The client used to fetch the storage URL directly, which is
 * cross-origin, and that was measured to be genuinely fragile:
 *   - `media.frenzsave.com` reflects CORS for `https://frenzsave.com` and
 *     `https://www.frenzsave.com` ONLY. A Vercel preview or local dev origin
 *     gets NO `access-control-allow-origin` back, so the fetch throws and the
 *     save fails — verified live against all four origins.
 *   - even where CORS passes, iOS requires `navigator.share()` to be called
 *     inside the user gesture, and `await fetch(...)` spends that gesture
 *     before the share ever happens.
 * Same-origin removes the first problem entirely (no preflight, no allowlist to
 * keep in sync with every new deploy domain) and lets us set a real
 * `Content-Disposition`, so the plain `<a download>` path works properly
 * instead of navigating.
 *
 * SECURITY — the host allowlist is the whole point. An endpoint that fetches a
 * caller-supplied URL is an open SSRF proxy: it would happily fetch
 * `http://169.254.169.254/…` (cloud metadata) or any internal address from
 * inside our own network. So: only our two real storage hosts, https only, and
 * signed-in callers only. Anything else is refused before a request is made.
 *
 * COST — this spends Vercel egress that a direct browser→R2 fetch wouldn't (see
 * the egress-cloudflare-storage notes: this project has hit a storage egress
 * cap before). Accepted deliberately, and bounded: saving is an explicit,
 * occasional, user-initiated action, not something the feed does per scroll.
 * The object streams straight through — never buffered into memory here.
 */

function allowedHosts(): string[] {
  const hosts: string[] = [];
  const r2 = process.env.R2_PUBLIC_BASE_URL;
  if (r2) {
    try {
      hosts.push(new URL(r2).host);
    } catch {
      /* misconfigured env — just don't allow it */
    }
  }
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabase) {
    try {
      hosts.push(new URL(supabase).host);
    } catch {
      /* ignore */
    }
  }
  return hosts;
}

/** Strip anything that could break out of the header (CR/LF) or the filename. */
function safeFilename(raw: string | null, fallbackExt: string): string {
  const cleaned = (raw ?? "")
    .replace(/[\r\n"\\]/g, "")
    .replace(/[/\\?%*:|<>]/g, "-")
    .trim()
    .slice(0, 120);
  return cleaned || `frenz-${Date.now()}.${fallbackExt}`;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const raw = params.get("url");
  if (!raw) return NextResponse.json({ error: "Missing url." }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url." }, { status: 400 });
  }
  // https only + our own storage hosts only. Fail closed.
  if (target.protocol !== "https:" || !allowedHosts().includes(target.host)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "Couldn't reach that file." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "That file is no longer available." }, { status: upstream.status === 404 ? 404 : 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const ext = contentType.split("/")[1]?.split(";")[0] ?? "bin";
  const filename = safeFilename(params.get("name"), ext);

  // Stream through — no buffering, so a large video doesn't sit in function memory.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length")! } : {}),
      // Private: this is one user's chat media behind an auth check — it must
      // never land in a shared/CDN cache.
      "Cache-Control": "private, no-store",
    },
  });
}
