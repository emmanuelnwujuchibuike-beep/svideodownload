import "server-only";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import type { RewardsConfig } from "@/lib/rewards/config";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WITHDRAWAL QUALIFICATION — the member applies, an admin grants (0191)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "they can apply for withdrawal when they qualify, and
 * admin reviews and grants their account qualification, and from there they
 * can withdraw."
 *
 *   none / rejected ──apply (thresholds met)──▶ applied ──admin──▶ approved | rejected
 *
 * Applying is checked HERE against the live rules — account age from
 * auth.users, engagements from the profile — never against anything the
 * browser says. Approval sets `qualified_at`, which is what the engine reads
 * to class every LATER reward as withdrawable. Each step is a conditional
 * update on the status it expects, so a double tap or two admins cannot apply
 * or approve twice.
 */
export type QualificationStatus = "none" | "applied" | "approved" | "rejected";

export async function applyForQualification(userId: string, config: RewardsConfig): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!config.enabled) return { ok: false, status: 503, error: "Rewards aren't open right now." };
  const db = createAdminClient();
  await db.from("reward_profiles").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const [{ data: profile }, user] = await Promise.all([
    db.from("reward_profiles").select("restricted, qualifying_engagements, qualification_status").eq("user_id", userId).maybeSingle(),
    db.auth.admin.getUserById(userId),
  ]);
  const p = profile as { restricted: boolean; qualifying_engagements: number; qualification_status: QualificationStatus } | null;
  if (!p) return { ok: false, status: 503, error: "Couldn't read your account. Try again." };
  if (p.restricted) return { ok: false, status: 403, error: "Rewards are paused on this account." };
  if (p.qualification_status === "approved") return { ok: false, status: 409, error: "You're already approved for withdrawals." };
  if (p.qualification_status === "applied") return { ok: false, status: 409, error: "Your application is already being reviewed." };
  const created = user.data.user?.created_at ? Date.parse(user.data.user.created_at) : NaN;
  const ageDays = Number.isFinite(created) ? Math.floor((Date.now() - created) / 86_400_000) : 0;
  const q = config.qualification;
  if (ageDays < q.minAccountAgeDays || p.qualifying_engagements < q.minEngagements) {
    return { ok: false, status: 403, error: `You can apply once your account is ${q.minAccountAgeDays} days old with ${q.minEngagements} qualifying engagements.` };
  }
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("reward_profiles")
    .update({ qualification_status: "applied", qualification_applied_at: now, updated_at: now })
    .eq("user_id", userId)
    .in("qualification_status", ["none", "rejected"])
    .select("user_id");
  if (error) {
    console.error("[rewards/qualification] apply failed", { userId, message: error.message });
    return { ok: false, status: 503, error: "Couldn't send your application. Try again." };
  }
  if (!data?.length) return { ok: false, status: 409, error: "Your application is already being reviewed." };
  console.info("[rewards/qualification] applied", { userId, ageDays, engagements: p.qualifying_engagements });
  return { ok: true };
}

export async function reviewQualification(input: { userId: string; approve: boolean; adminId: string; note: string | null }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const patch = input.approve
    ? { qualification_status: "approved", qualified_at: now, qualification_reviewed_at: now, qualification_reviewed_by: input.adminId, qualification_note: input.note, updated_at: now }
    : { qualification_status: "rejected", qualification_reviewed_at: now, qualification_reviewed_by: input.adminId, qualification_note: input.note, updated_at: now };
  const { data, error } = await db.from("reward_profiles").update(patch).eq("user_id", input.userId).eq("qualification_status", "applied").select("user_id");
  if (error) {
    console.error("[rewards/qualification] review failed", { userId: input.userId, message: error.message });
    return { ok: false, status: 503, error: "Couldn't save that." };
  }
  if (!data?.length) return { ok: false, status: 409, error: "That member has no application waiting." };
  console.info("[rewards/qualification] reviewed", { userId: input.userId, approve: input.approve, admin: input.adminId });
  await sendSmartPush(
    input.userId,
    {
      title: input.approve ? "You're approved for withdrawals" : "Withdrawal application not approved",
      body: input.approve
        ? "Rewards you earn from now on are withdrawable. Tap to see your rewards."
        : input.note
          ? `Not approved this time: ${input.note.slice(0, 160)}`
          : "Not approved this time. Your AI credits are unaffected, and you can apply again later.",
      url: `${SITE_URL}/rewards`,
      genericBody: "An update on your rewards.",
      tag: `reward-qualification-${input.userId}`,
    },
    "high",
    "premium",
    { type: "withdrawal_update" },
  ).catch(() => {});
  return { ok: true };
}
