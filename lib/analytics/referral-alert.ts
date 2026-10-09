import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminUserIds } from "@/lib/support/chat";

/**
 * Push every admin about referral activity (owner, 2026-10-09: "make admin
 * receive push notifications on every user who copied the referral link and
 * also when a user signed in through a referral link").
 *
 *   · a member copies (or shares, on a phone's share sheet) their invite link
 *   · someone signs in and the referral link they arrived through is attributed
 *
 * The same admin fan-out the sign-in alert and the Support inbox use.
 * Best-effort: never throws into the caller, never delays it.
 */

type Who = { name: string; handle: string | null };

async function who(userId: string): Promise<Who> {
  try {
    const db = createAdminClient();
    const { data } = await db.from("profiles").select("display_name, handle").eq("id", userId).maybeSingle();
    const handle = (data?.handle as string | null) ?? null;
    return { name: (data?.display_name as string | null) || (handle ? `@${handle}` : "A member"), handle };
  } catch {
    return { name: "A member", handle: null };
  }
}

async function pushAdmins(title: string, body: string, tag: string): Promise<void> {
  try {
    const adminIds = await resolveAdminUserIds();
    await Promise.all(
      adminIds.map((id) => sendSmartPush(id, { title, body, url: `${SITE_URL}/admin`, tag }, "high", "system", { type: "system" }).catch(() => {})),
    );
  } catch {
    /* push is best-effort */
  }
}

/** A member copied or shared their referral (invite) link. */
export async function notifyAdminsOfReferralShare(userId: string, how: "copied" | "shared", surface: string): Promise<void> {
  const u = await who(userId);
  await pushAdmins(
    `Referral link ${how} · ${u.name}`,
    `${u.handle ? `@${u.handle} ` : ""}${how} their invite link (${surface}).`,
    "referral-share",
  );
}

/** Someone signed in through a referral link and was attributed to the referrer. */
export async function notifyAdminsOfReferralSignIn(referredId: string, referrerId: string | null): Promise<void> {
  const [referred, referrer] = await Promise.all([who(referredId), referrerId ? who(referrerId) : Promise.resolve(null)]);
  await pushAdmins(
    `Referral sign-in · ${referred.name}`,
    `${referred.handle ? `@${referred.handle} ` : ""}signed in through ${referrer ? `${referrer.handle ? `@${referrer.handle}` : referrer.name}'s` : "a"} referral link.`,
    "referral-signin",
  );
}
