import { NextResponse } from "next/server";

import { TOKEN_RE, unsubscribeWithToken } from "@/lib/email/consent";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe from OPTIONAL email (Frenzsave Part 11, 0253; lib/email/consent.ts).
 *
 *   GET  never changes anything. Link scanners, previews and prefetchers open links; opening one
 *        must not unsubscribe anyone. It sends the browser to /unsubscribe, which asks first.
 *   POST turns optional email off for the token's member — from the page's button, or from a mail
 *        client's RFC 8058 one-click (body "List-Unsubscribe=One-Click", the token in the URL that
 *        the List-Unsubscribe header named). Idempotent: a second POST is the same answer.
 *
 * No sign-in: the token IS the authority, and it can only switch optional email off. The answer
 * never names the member or the address, and an unknown token reads exactly like a malformed one.
 * The token is never logged.
 */

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const page = (q: string) => NextResponse.redirect(`${SITE_URL}/unsubscribe${q}`, { status: 303, headers: HEADERS });

export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  // only a well-formed token travels on; anything else lands on the plain "not valid" page
  return page(TOKEN_RE.test(t) ? `?t=${t}` : "?state=invalid");
}

export async function POST(request: Request) {
  const { success } = await trackLimiter.limit(`unsubscribe:${clientId(request.headers)}`);
  if (!success) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: HEADERS });

  const form = await request.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const raw = new URL(request.url).searchParams.get("t") ?? form?.get("t");
  const out = await unsubscribeWithToken(typeof raw === "string" ? raw : null);

  // a mail client's one-click: a status, no page
  if (oneClick) return new NextResponse(out.ok ? "Unsubscribed." : "This link isn't valid.", { status: out.ok ? 200 : 400, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  if (out.ok) return page("?state=done");
  return page(out.reason === "invalid" ? "?state=invalid" : "?state=error");
}
