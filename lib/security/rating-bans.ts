import "server-only";

import { forgetBans } from "@/lib/security/app-bans";
import { moderate } from "@/lib/social/moderation";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Banning someone FROM THEIR APP RATING (owner, 2026-10-22: "admin can ban anonymous users who rate the
 * app, admin can ban signed in users who rate the app").
 *
 * A ban row (app_bans, 0267) carries every identifier the rating was made with — the account (when
 * signed in), the device id, the fingerprint, the network address and the browser — so the fetch check
 * (lib/security/app-bans.ts) catches the person however they come back. A SIGNED-IN rater's account is
 * also suspended through the existing, audited moderation path (`moderate`), the same one the admin's
 * Ban button on an account uses — one write path, one audit trail. Lifting reverses both.
 */

type Result = { ok: true } | { ok: false; status: number; error: string };

export async function banRater(ratingId: string, adminId: string, reason: string | null): Promise<Result> {
  const db = createAdminClient();
  const { data: r, error } = await db.from("app_ratings").select("id, user_id, device_id, fingerprint, ip, user_agent").eq("id", ratingId).maybeSingle();
  if (error) return { ok: false, status: 500, error: "Couldn't read that rating. Is migration 0267 applied?" };
  if (!r) return { ok: false, status: 404, error: "That rating no longer exists." };
  const row = r as { user_id: string | null; device_id: string | null; fingerprint: string | null; ip: string | null; user_agent: string | null };
  if (!row.user_id && !row.device_id && !row.fingerprint && !row.ip) {
    return { ok: false, status: 409, error: "This rating was left before device details were recorded, so there is nothing to ban it by." };
  }
  const { data: open } = await db.from("app_bans").select("id").eq("rating_id", ratingId).is("lifted_at", null).limit(1);
  if (!open?.length) {
    const { error: insertError } = await db.from("app_bans").insert({
      user_id: row.user_id,
      device_id: row.device_id,
      fingerprint: row.fingerprint,
      ip: row.ip,
      user_agent: row.user_agent,
      rating_id: ratingId,
      reason,
      banned_by: adminId,
    });
    if (insertError) return { ok: false, status: 500, error: "Couldn't save the ban." };
  }
  if (row.user_id) {
    const res = await moderate("user", row.user_id, "suspend", adminId, reason ? `Rating ban: ${reason}` : "Rating ban");
    if (!res.ok && res.status !== 409) return { ok: false, status: 500, error: "The device is banned, but the account couldn't be suspended. Try again." };
  }
  forgetBans();
  return { ok: true };
}

export async function unbanRater(ratingId: string, adminId: string): Promise<Result> {
  const db = createAdminClient();
  const { data: bans, error } = await db.from("app_bans").select("id, user_id").eq("rating_id", ratingId).is("lifted_at", null);
  if (error) return { ok: false, status: 500, error: "Couldn't read the ban." };
  if (!bans?.length) return { ok: true };
  const { error: liftError } = await db.from("app_bans").update({ lifted_at: new Date().toISOString(), lifted_by: adminId }).in("id", bans.map((b) => b.id as string));
  if (liftError) return { ok: false, status: 500, error: "Couldn't lift the ban." };
  for (const userId of new Set(bans.map((b) => b.user_id as string | null).filter((u): u is string => !!u))) {
    await moderate("user", userId, "unsuspend", adminId, "Rating ban lifted");
  }
  forgetBans();
  return { ok: true };
}
