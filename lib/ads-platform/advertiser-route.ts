import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { adApplicationLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { AdApplicationError } from "./advertiser-server";
import { adMessage, type MessageFacts } from "./messages";

/**
 * The one wrapper every advertiser route runs through: a signed-in member
 * (the existing Frenzsave session — there is no advertiser login), a rate
 * limit, the service-role client, and refusals turned into
 * `{ error: code, message, facts }` with plain words. An unexpected failure is
 * logged and answered with a generic line — never the internal error.
 */
export async function advertiserRoute(
  request: Request,
  handler: (ctx: { db: SupabaseClient; userId: string; email: string | null; body: Record<string, unknown> }) => Promise<unknown>,
): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in", message: adMessage("sign_in") }, { status: 401 });
  const burst = await adApplicationLimiter.limit(`ad-app:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "rate_limited", message: adMessage("rate_limited") }, { status: 429 });

  let body: Record<string, unknown> = {};
  if (request.method !== "GET") {
    try {
      const parsed: unknown = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "bad_request", message: adMessage("bad_request") }, { status: 400 });
    }
  }

  try {
    const result = await handler({ db: createAdminClient(), userId: user.id, email: user.email ?? null, body });
    return NextResponse.json(result ?? { ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AdApplicationError) {
      return NextResponse.json({ error: e.code, message: adMessage(e.code, e.facts as MessageFacts), facts: e.facts }, { status: e.status, headers: { "cache-control": "no-store" } });
    }
    console.error("[ads-platform] advertiser route failed", { path: new URL(request.url).pathname, error: String(e).slice(0, 300) });
    return NextResponse.json({ error: "server", message: adMessage("server") }, { status: 500 });
  }
}

export const str = (v: unknown, max = 2048): string => (typeof v === "string" ? v.slice(0, max) : "");
export const strList = (v: unknown, max = 10): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);
