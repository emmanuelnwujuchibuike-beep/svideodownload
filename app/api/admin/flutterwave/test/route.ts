import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/require-admin";
import { CONNECTION_TEST_COPY, testFlutterwaveConnection } from "@/lib/flutterwave/connection-test";
import { subVerifyLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Part 5 — Admin → Flutterwave → "Test connection" (lib/flutterwave/connection-test.ts): one read-only call with the
 * saved key. Answers a fixed code, the key's mode and fixed copy — never the key, the provider's message or its body.
 * Admin only, rate limited, recorded in the financial audit log (code and mode only).
 */
export async function POST() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { success } = await subVerifyLimiter.limit(`admin-flutterwave-test:${gate.user.id}`);
  if (!success) return NextResponse.json({ error: "Too many tests — wait a moment." }, { status: 429 });
  const out = await testFlutterwaveConnection();
  const { error } = await createAdminClient()
    .from("financial_audit_log")
    .insert({ actor_id: gate.user.id, action: "admin_flutterwave_connection_test", target_type: "payment_provider", target_id: "flutterwave", reference: null, details: { code: out.code, mode: out.mode } });
  if (error) console.error("[admin/flutterwave] connection test audit write failed");
  return NextResponse.json({ ...out, message: CONNECTION_TEST_COPY[out.code] }, { headers: { "Cache-Control": "private, no-store" } });
}
