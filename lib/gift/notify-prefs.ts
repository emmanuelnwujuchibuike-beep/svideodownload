import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Frenz Gift Coin Part 4.1 (0294): the member's two gift-notification switches, notification_settings.gift_push and
 * notification_settings.gift_email. Independent — writing one never touches the other — and ON by default (the policy
 * every per-event switch here follows). They decide only whether the gift is ANNOUNCED: the gift message is in the chat
 * and the earnings in the wallet whatever they say. The global controls still apply on top (lib/gift/gift-notify.ts).
 *
 * Reads fail open to "on" (as wallet prefs do) — the global switches still apply, and a member is never cut off from a
 * notification by a read error; writes go only to the member's own row (the route passes the session user).
 */
export interface GiftNotifyPrefs {
  push: boolean;
  email: boolean;
}

export const DEFAULT_GIFT_NOTIFY_PREFS: GiftNotifyPrefs = { push: true, email: true };

const MISSING = (m: string) => /gift_push|gift_email|column|schema cache|does not exist/i.test(m);

export async function getGiftNotifyPrefs(userId: string): Promise<GiftNotifyPrefs & { ready: boolean }> {
  try {
    const { data, error } = await createAdminClient().from("notification_settings").select("gift_push, gift_email").eq("user_id", userId).maybeSingle();
    if (error) return { ...DEFAULT_GIFT_NOTIFY_PREFS, ready: !MISSING(error.message) };
    const r = data as { gift_push?: unknown; gift_email?: unknown } | null;
    return { push: r?.gift_push !== false, email: r?.gift_email !== false, ready: true };
  } catch {
    return { ...DEFAULT_GIFT_NOTIFY_PREFS, ready: true };
  }
}

/** Save the given switch(es) for the member's own row. Only what was sent is written. */
export async function setGiftNotifyPrefs(userId: string, patch: Partial<GiftNotifyPrefs>): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (typeof patch.push === "boolean") row.gift_push = patch.push;
  if (typeof patch.email === "boolean") row.gift_email = patch.email;
  if (!("gift_push" in row) && !("gift_email" in row)) return { ok: false, status: 400, error: "Nothing to save." };
  // upsert with only these columns: an existing row keeps every other setting; a new row gets the table defaults
  const { error } = await createAdminClient().from("notification_settings").upsert(row, { onConflict: "user_id" });
  if (!error) return { ok: true };
  return MISSING(error.message) ? { ok: false, status: 503, error: "Gift notification settings arrive with the next update." } : { ok: false, status: 500, error: "Couldn't save." };
}
