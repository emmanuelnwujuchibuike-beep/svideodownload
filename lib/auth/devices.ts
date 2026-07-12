import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { parseDevice, type DeviceIcon } from "@/lib/auth/device-label";
import { createAdminClient } from "@/lib/supabase/admin";

/** Long-lived, httpOnly device identity — survives sign-out/sign-in so a
 *  "trusted device" designation isn't lost on the next login. Deliberately
 *  NOT sessionStorage/localStorage: those don't survive a full sign-out in
 *  every browser (some clear site data), and we need this to be readable
 *  server-side without a client round-trip. */
const DEVICE_KEY_COOKIE = "frenz_device_key";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export interface TrustedDeviceRow {
  id: string;
  user_id: string;
  device_key: string;
  current_session_id: string | null;
  label: string;
  is_trusted: boolean;
  last_seen_at: string;
}

/** Reads the device-key cookie, minting + setting a new one if absent. Only
 *  callable from a Route Handler (cookies().set requires that context). */
export async function getOrCreateDeviceKey(): Promise<string> {
  const store = await cookies();
  const existing = store.get(DEVICE_KEY_COOKIE)?.value;
  if (existing) return existing;

  const key = randomUUID();
  store.set(DEVICE_KEY_COOKIE, key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return key;
}

/**
 * Upserts this browser's `trusted_devices` row (migration 0054). Default
 * `label` is only ever set on first INSERT — an existing row's label (which
 * may have been renamed by the user) is never clobbered by a later visit.
 * Called from the same client-origin device-check request that already
 * fires `checkNewDevice` — see app/api/auth/device-check/route.ts.
 */
export async function upsertTrustedDevice(
  userId: string,
  sessionId: string | null,
  userAgent: string | null,
): Promise<void> {
  const deviceKey = await getOrCreateDeviceKey();
  const db = createAdminClient();

  const { data: existing } = await db
    .from("trusted_devices")
    .select("id")
    .eq("user_id", userId)
    .eq("device_key", deviceKey)
    .maybeSingle();

  if (existing) {
    await db
      .from("trusted_devices")
      .update({
        current_session_id: sessionId,
        last_seen_at: new Date().toISOString(),
        last_user_agent: userAgent,
      })
      .eq("id", existing.id);
    return;
  }

  const { label } = parseDevice(userAgent);
  await db.from("trusted_devices").insert({
    user_id: userId,
    device_key: deviceKey,
    current_session_id: sessionId,
    label,
    last_user_agent: userAgent,
  });
}

export interface MergedSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  device: { label: string; icon: DeviceIcon };
  isCurrent: boolean;
  isTrusted: boolean;
  deviceRowId: string | null;
}

/**
 * Left-joins Supabase's real session list with our `trusted_devices` rows
 * (matched by `current_session_id`) in application code — deliberately NOT
 * a SQL join, since `auth.sessions` is only reachable via the SECURITY
 * DEFINER `list_user_sessions` function (see migration 0034), not a
 * directly joinable table. Devices predating this migration (no matching
 * row yet) fall back to the existing `parseDevice(user_agent)` label —
 * strictly additive, nothing regresses for them.
 */
export async function mergeSessionsWithDevices(
  userId: string,
  rows: { id: string; created_at: string; updated_at: string | null; user_agent: string | null }[],
  currentSessionId: string | null,
): Promise<MergedSession[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("trusted_devices")
    .select("id, current_session_id, label, is_trusted")
    .eq("user_id", userId);
  const devices = (data ?? []) as Pick<TrustedDeviceRow, "id" | "current_session_id" | "label" | "is_trusted">[];
  const byCession = new Map(devices.filter((d) => d.current_session_id).map((d) => [d.current_session_id, d]));

  return rows.map((row) => {
    const matched = byCession.get(row.id);
    const parsed = parseDevice(row.user_agent);
    return {
      id: row.id,
      createdAt: row.created_at,
      lastActiveAt: row.updated_at ?? row.created_at,
      device: { label: matched?.label || parsed.label, icon: parsed.icon },
      isCurrent: row.id === currentSessionId,
      isTrusted: matched?.is_trusted ?? false,
      deviceRowId: matched?.id ?? null,
    };
  });
}
