import "server-only";

import type { AiFeature } from "@/lib/ai/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the daily allowance, spent and refunded
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three calls into three SQL functions (migration 0141). The reasoning that
 * matters — why the reservation is a single atomic statement, why a refund is
 * capped — lives in the migration beside the code it protects. What lives here
 * is the failure posture, which is a TypeScript decision.
 *
 * ── 🔴 THIS FAILS CLOSED. THE DOWNLOAD COUNTER FAILS OPEN. ───────────────────
 *
 * `consumeDaily` in lib/rate-limit.ts allows the action when Redis is
 * unreachable, and that is right there: a broken counter must never be what
 * stops somebody downloading a video, and the cost of being wrong is one free
 * download.
 *
 * Here the cost of being wrong is the OWNER'S MONEY at a provider, charged per
 * job, with no ceiling and no way to claw it back. A metering outage that
 * defaulted to "allow" would turn a database hiccup into an unbounded bill, and
 * it would do it silently and fastest exactly when the system is least healthy.
 *
 * So an unreadable counter refuses. A member sees "this isn't available right
 * now"; nobody is charged for a failure they did not cause; the owner's bill
 * cannot run away while the thing that would have stopped it is down. That is
 * the honest direction for a limit that guards a spend rather than a courtesy.
 *
 * Server-only: `createAdminClient` bypasses RLS, and these functions are
 * revoked from every role a browser can hold.
 */

export interface AiUsageReservation {
  allowed: boolean;
  /** Reservations counted against today, including this one when allowed. */
  used: number;
  remaining: number;
}

/**
 * Take one slot for today, atomically, or refuse.
 *
 * The limit comes from the caller's entitlement rather than from a table here:
 * `lib/ai/entitlement.ts` already resolves plan, promo and abuse ceiling, and
 * two places deciding what a plan is worth is one place too many.
 */
export async function reserveAiUsage(
  userId: string,
  feature: AiFeature,
  limit: number,
): Promise<AiUsageReservation> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .rpc("reserve_ai_usage", { p_user_id: userId, p_feature: feature, p_limit: limit })
      .single<{ allowed: boolean; used: number; remaining: number }>();

    if (error || !data) {
      // 🔴 A PostgREST failure resolves as `{ error }` — it does not throw. A
      // `try` alone would sail past this and return "allowed" for a call that
      // never happened; that trap is a standing law on this project.
      console.error("[ai/usage] reserve failed", { feature, code: error?.code, message: error?.message });
      return { allowed: false, used: 0, remaining: 0 };
    }
    return { allowed: data.allowed, used: data.used, remaining: data.remaining };
  } catch (e) {
    console.error("[ai/usage] reserve threw", { feature, error: String(e) });
    return { allowed: false, used: 0, remaining: 0 };
  }
}

/**
 * Record that a reserved job actually finished.
 *
 * Does not touch the reservation — the slot was spent at admission and has been
 * holding the cap ever since. Never throws: a job that has genuinely completed
 * must not be reported as failed because a counter update did not land, and the
 * cap is unaffected either way (see the migration).
 */
export async function consumeAiUsage(userId: string, feature: AiFeature): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("consume_ai_usage", {
      p_user_id: userId,
      p_feature: feature,
    });
    if (error) {
      console.error("[ai/usage] consume failed", { feature, code: error.code, message: error.message });
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("[ai/usage] consume threw", { feature, error: String(e) });
    return false;
  }
}

/**
 * How many refunds one member may be granted in a day.
 *
 * Equal to their own daily allowance: three free jobs means at most three
 * refunds, so a run of genuine infrastructure failures never costs somebody
 * their day, and a deliberate fail-and-retry loop tops out at twice the
 * allowance instead of running forever. Beyond the cap the release is still
 * RECORDED (see `release_ai_usage`) — the counter that stops the loop is also
 * the evidence that somebody tried it.
 */
export function releaseCapFor(dailyLimit: number): number {
  return Math.max(1, Math.floor(dailyLimit));
}

export interface AiUsageRelease {
  released: boolean;
  reserved: number;
}

/**
 * Give a reserved slot back.
 *
 * Called when the failure was OURS or the provider's — never when the member's
 * input was the problem, and never when work actually ran. Failure here is
 * logged and swallowed: the member has already been told their job failed, and
 * a second error about the refund would be noise about something only we can
 * fix.
 */
export async function releaseAiUsage(
  userId: string,
  feature: AiFeature,
  dailyLimit: number,
): Promise<AiUsageRelease> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .rpc("release_ai_usage", {
        p_user_id: userId,
        p_feature: feature,
        p_max_releases: releaseCapFor(dailyLimit),
      })
      .single<{ released: boolean; reserved: number }>();

    if (error || !data) {
      console.error("[ai/usage] release failed", { feature, code: error?.code, message: error?.message });
      return { released: false, reserved: 0 };
    }
    return { released: data.released, reserved: data.reserved };
  } catch (e) {
    console.error("[ai/usage] release threw", { feature, error: String(e) });
    return { released: false, reserved: 0 };
  }
}

/**
 * Today's count, WITHOUT spending anything.
 *
 * So an interface can say "1 left today" before somebody commits to a video.
 * Reading an allowance must never consume it — the same law `peekDaily` obeys
 * for downloads, and the reason both exist as separate functions rather than a
 * flag on the charging one.
 *
 * Fails to 0 rather than closed: this is a display value, and a counter that
 * cannot be read is not a reason to tell somebody they have used something they
 * have not. The CHARGE still fails closed, which is where it matters.
 */
export async function peekAiUsage(userId: string, feature: AiFeature): Promise<number> {
  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await admin
      .from("ai_usage_daily")
      .select("reserved_jobs")
      .eq("user_id", userId)
      .eq("feature", feature)
      .eq("usage_date", today)
      .maybeSingle();
    if (error || !data) return 0;
    return typeof data.reserved_jobs === "number" ? data.reserved_jobs : 0;
  } catch {
    return 0;
  }
}
