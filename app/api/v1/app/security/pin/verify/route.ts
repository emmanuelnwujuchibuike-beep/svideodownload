import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { pinLimiter } from "@/lib/rate-limit";
import { fromBytea } from "@/lib/security/bytea";
import { verifyPin } from "@/lib/security/pin";
import { writeAuditLog } from "@/lib/security/audit-log";
import { issueStepUp } from "@/lib/security/stepup";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000;

const schema = z.object({ pin: z.string().min(1).max(8) });

/**
 * POST /api/v1/app/security/pin/verify — unlock check for the app-level
 * quick-lock gate. Lockout state lives server-side (`failed_attempts`/
 * `locked_until`) since a client-only lockout is trivially bypassed by a
 * page reload.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await pinLimiter.limit(`pin-verify:${user.id}`);
  if (!success) return fail("rate_limited");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed");

  const db = createAdminClient();
  const { data: row } = await db
    .from("security_pin")
    .select("pin_hash, pin_salt, failed_attempts, locked_until, auto_lock_minutes")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) return fail("not_found", "No PIN is set.");

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return fail("forbidden", "Too many attempts. Try again later.");
  }

  const valid = verifyPin(parsed.data.pin, fromBytea(row.pin_hash), fromBytea(row.pin_salt));
  if (!valid) {
    const attempts = row.failed_attempts + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
    await db
      .from("security_pin")
      .update({ failed_attempts: attempts, locked_until: lockedUntil })
      .eq("user_id", user.id);
    if (lockedUntil) await writeAuditLog({ userId: user.id, eventType: "pin_lockout", request });
    return noStore(ok({ ok: false }));
  }

  await db.from("security_pin").update({ failed_attempts: 0, locked_until: null }).eq("user_id", user.id);

  // Also proves possession server-side (not just a client sessionStorage
  // flag) so Server Components (the /messages list+thread, /account/security
  // pages) can gate the actual data they embed in SSR — a client-only lock
  // still let real message content ship in the initial HTML before the
  // overlay ever painted. TTL matches this account's own auto-lock window.
  await issueStepUp(user.id, "pin-unlock", row.auto_lock_minutes * 60_000);
  return noStore(ok({ ok: true }));
}
