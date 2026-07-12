import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { pinLimiter } from "@/lib/rate-limit";
import { fromBytea, toBytea } from "@/lib/security/bytea";
import { hashPin, verifyPin } from "@/lib/security/pin";
import { writeAuditLog } from "@/lib/security/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const PIN_RE = /^\d{4,8}$/;
const schema = z.object({
  currentPin: z.string().regex(PIN_RE).optional(),
  newPin: z.string().regex(PIN_RE),
  autoLockMinutes: z.number().int().min(1).max(60).optional(),
});

/** POST /api/v1/app/security/pin — set or change the quick-lock PIN. Requires the current PIN if one is already set. */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await pinLimiter.limit(`pin-set:${user.id}`);
  if (!success) return fail("rate_limited");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed", "PIN must be 4-8 digits.");

  const db = createAdminClient();
  const { data: existing } = await db
    .from("security_pin")
    .select("pin_hash, pin_salt")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    if (!parsed.data.currentPin || !verifyPin(parsed.data.currentPin, fromBytea(existing.pin_hash), fromBytea(existing.pin_salt))) {
      return fail("forbidden", "Your current PIN is incorrect.");
    }
  }

  const { hash, salt } = hashPin(parsed.data.newPin);
  const { error } = await db.from("security_pin").upsert(
    {
      user_id: user.id,
      pin_hash: toBytea(hash),
      pin_salt: toBytea(salt),
      pin_length: parsed.data.newPin.length,
      failed_attempts: 0,
      locked_until: null,
      auto_lock_minutes: parsed.data.autoLockMinutes ?? 5,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return fail("internal");

  await writeAuditLog({ userId: user.id, eventType: "pin_set", request });
  return noStore(ok({ ok: true }));
}
