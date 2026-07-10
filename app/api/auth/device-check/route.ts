import { NextResponse } from "next/server";

import { checkNewDevice } from "@/lib/auth/device-check";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/device-check — called once per browser session (see
 * `features/app-shell/device-check.tsx`) right after the authenticated app
 * shell mounts. A same-origin fetch from the real browser, so the
 * `user-agent` header here is the actual device's — see the long comment in
 * `lib/auth/device-check.ts` for why this can't be done from inside the
 * server-side OAuth/magic-link routes instead. Always 200s (best-effort);
 * never something a caller needs to retry or handle specially.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const notified = await checkNewDevice(user.id, request.headers.get("user-agent"));
  return NextResponse.json({ ok: true, notified });
}
