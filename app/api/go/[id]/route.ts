import { NextResponse } from "next/server";

import { recordAffiliateClick } from "@/lib/analytics/events";
import { countryFromHeaders, deviceFromUA } from "@/lib/monetization/context";
import { getOfferUrl } from "@/lib/monetization/affiliates";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only ever redirect to a real external http(s) URL. */
function safeExternal(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* invalid */
  }
  return null;
}

/**
 * Tracked affiliate redirect: records the click (funnel) then 302s to the
 * offer's destination. The destination is read server-side from the DB — the
 * client can never inject an arbitrary redirect target.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const home = SITE_URL || new URL(request.url).origin;
  if (!UUID.test(id)) return NextResponse.redirect(home, 302);

  // Light flood protection.
  const { success } = await trackLimiter.limit(clientId(request.headers));
  if (!success) return NextResponse.redirect(home, 302);

  const raw = await getOfferUrl(id);
  const dest = raw ? safeExternal(raw) : null;
  if (!dest) return NextResponse.redirect(home, 302);

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anon */
  }

  recordAffiliateClick(id, {
    userId,
    country: countryFromHeaders(request.headers),
    device: deviceFromUA(request.headers.get("user-agent")),
  });

  return NextResponse.redirect(dest, 302);
}
