import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore } from "@/lib/api/edge-cache";
import { fail, ok } from "@/lib/api/respond";
import { deviceLimiter } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  isTrusted: z.boolean().optional(),
});

/**
 * PATCH /api/v1/app/devices/:id — rename a device and/or toggle "trusted",
 * operating on `trusted_devices.id` (migration 0054), NOT the Supabase
 * session id. Uses the admin client with an explicit `user_id` filter on
 * every query (same trusted pattern as the sessions routes) so bearer
 * (native/desktop) callers work identically to the cookie-based web app.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await deviceLimiter.limit(`device-patch:${user.id}`);
  if (!success) return fail("rate_limited");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed");
  if (!parsed.data.label && parsed.data.isTrusted === undefined) return fail("bad_request", "Nothing to update.");

  const patch: Record<string, unknown> = {};
  if (parsed.data.label) patch.label = parsed.data.label;
  if (parsed.data.isTrusted !== undefined) patch.is_trusted = parsed.data.isTrusted;

  const { data, error } = await createAdminClient()
    .from("trusted_devices")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, label, is_trusted")
    .maybeSingle();

  if (error) return fail("internal");
  if (!data) return fail("not_found", "That device isn't yours.");

  await writeAuditLog({
    userId: user.id,
    eventType: parsed.data.isTrusted !== undefined ? "device_trust_changed" : "device_renamed",
    request,
    metadata: { deviceId: id, label: parsed.data.label, isTrusted: parsed.data.isTrusted },
  });

  return noStore(ok({ device: { id: data.id, label: data.label, isTrusted: data.is_trusted } }));
}

/** DELETE /api/v1/app/devices/:id — "forget this device" (does not sign it out — use the sessions endpoints for that). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized");

  const { success } = await deviceLimiter.limit(`device-delete:${user.id}`);
  if (!success) return fail("rate_limited");

  const { error, count } = await createAdminClient()
    .from("trusted_devices")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return fail("internal");
  if (!count) return fail("not_found", "That device isn't yours.");

  await writeAuditLog({ userId: user.id, eventType: "device_forgotten", request, metadata: { deviceId: id } });

  return noStore(ok({ forgotten: true }));
}
