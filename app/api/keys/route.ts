import { NextResponse } from "next/server";
import { z } from "zod";

import { trackEvent } from "@/lib/analytics/events";
import { generateRawKey } from "@/lib/api/keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** GET /api/keys — list the signed-in user's API keys (never the secret). */
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, last_used, revoked, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ keys: data ?? [] });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(40).optional() });

/** POST /api/keys — create a key; the raw secret is returned exactly once. */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let name = "Default";
  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (parsed.success && parsed.data.name) name = parsed.data.name;
  } catch {
    /* default name */
  }

  const admin = createAdminClient();
  const { count } = await admin
    .from("api_keys")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("revoked", false);
  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: "Key limit reached (10). Revoke one first." }, { status: 400 });
  }

  const { raw, hash, prefix } = generateRawKey();
  const { data, error } = await admin
    .from("api_keys")
    .insert({ user_id: user.id, name, key_hash: hash, key_prefix: prefix })
    .select("id, name, key_prefix, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Couldn't create key." }, { status: 500 });
  }

  trackEvent("api_key_created", { userId: user.id, metadata: { keyId: data.id } });
  // `key` is the ONLY time the raw secret is ever returned.
  return NextResponse.json({ key: raw, info: data });
}
