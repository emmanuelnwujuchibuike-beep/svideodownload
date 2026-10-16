import { NextResponse } from "next/server";
import { z } from "zod";

import { actorKeyFor } from "@/lib/ads-platform/engagement";
import { getRequestUser } from "@/lib/auth/request-user";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The full-screen ad's counts and its Like button (owner, 2026-10-15: "Make users
 * to be able to see the views, share, and likes of a full screen ad like tiktok.
 * The views should be the x10 multiplier. Signed and anonymous users should be
 * able to like an Ad").
 *
 * GET  ?c=<campaign>&v=<visitor id>        { views, likes, shares, liked }
 * POST { c, kind: "like" | "share", on, v } the same, after the change
 *
 * A signed-in member counts by account; a signed-out visitor by the anonymous
 * visitor id the ad events already send (`frenz_vid`). Views are the campaign's
 * qualifying impressions times its stats_multiplier — the figure its own
 * dashboard shows. Before 0246 runs both answer 503 and the ad shows no counts
 * (never a made-up number). Per-viewer (`liked`), so never cached.
 */
const UUID = z.string().uuid();
const VISITOR = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const postSchema = z.object({ c: UUID, kind: z.enum(["like", "share"]), on: z.boolean(), v: VISITOR.nullable().optional() }).strict();

const NO_STORE = { "Cache-Control": "private, no-store" };
const unavailable = () => NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });

/** Sign-in is read only when the request carries a session — a signed-out visitor costs no auth round trip. */
async function actorOf(request: Request, visitor: string | null | undefined) {
  const hasSession = /sb-[^=]*-auth-token/.test(request.headers.get("cookie") ?? "") || !!request.headers.get("authorization");
  const user = hasSession ? await getRequestUser(request).catch(() => null) : null;
  return { user, key: actorKeyFor(user?.id ?? null, visitor ?? null) };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const c = UUID.safeParse(url.searchParams.get("c"));
  if (!c.success) return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE });
  const v = VISITOR.safeParse(url.searchParams.get("v"));
  const { key } = await actorOf(request, v.success ? v.data : null);
  const { data, error } = await createAdminClient().rpc("ad_engagement", { p_campaign: c.data, p_actor: key });
  if (error) return unavailable();
  if (!data) return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
  return NextResponse.json(data, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const { success } = await trackLimiter.limit(`ad-react:${clientId(request.headers)}`);
  if (!success) return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429, headers: NO_STORE });
  const body = postSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400, headers: NO_STORE });
  const { user, key } = await actorOf(request, body.data.v);
  if (!key) return NextResponse.json({ ok: false, reason: "no_actor" }, { status: 400, headers: NO_STORE });
  const { data, error } = await createAdminClient().rpc("ad_react", {
    p_campaign: body.data.c,
    p_kind: body.data.kind,
    p_actor: key,
    p_user: user?.id ?? null,
    p_on: body.data.on,
  });
  if (error) return unavailable();
  const r = data as { ok?: boolean; reason?: string } | null;
  return NextResponse.json(r ?? { ok: false }, { status: r?.ok ? 200 : r?.reason === "not_found" ? 404 : 409, headers: NO_STORE });
}
