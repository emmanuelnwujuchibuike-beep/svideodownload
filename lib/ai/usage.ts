import "server-only";

import type { AiFeature } from "@/lib/ai/jobs";
import type { AiSubject } from "@/lib/ai/subject";
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
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 A DEPLOY AND A MIGRATION ARE TWO EVENTS, AND EITHER CAN LAND FIRST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Learned in production, 2026-09-08 (owner: "now all ai remover is showing that
 * didnt finish in less than 3secs").
 *
 * The guest release shipped code that calls `reserve_ai_usage` with six
 * arguments and a migration that creates it. Vercel deployed in about a minute;
 * the Supabase migration had not applied. For that window EVERY job failed
 * instantly — the function did not exist, PostgREST answered "Could not find
 * the function", the reservation failed CLOSED as designed, and the member was
 * told their clean did not finish.
 *
 * Failing closed was right. Assuming the schema was the mistake. A commit
 * message saying "0145 must apply first" is not a mechanism, and the two
 * systems have no ordering guarantee between them in either direction.
 *
 * So the call is written to work against BOTH schemas: it tries the new
 * signature and, only when the answer is specifically "that function does not
 * exist", falls back to the pre-0145 one. Every other error still fails closed.
 *
 * ⚠️ The fallback cannot serve a GUEST — there is no column to count them in
 * before 0145 — so a guest is refused rather than mis-metered. That is the
 * correct degradation: signed-in members keep working through the window, and
 * the anonymous tier simply waits for its schema.
 *
 * Once 0145 is applied everywhere this branch is dead weight, and it is
 * deliberately being left: the next migration to add a parameter will hit the
 * same window, and this is the shape that survives it.
 */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

function functionMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && MISSING_FUNCTION.has(error.code)) return true;
  return /could not find the function|does not exist/i.test(error.message ?? "");
}

export async function reserveAiUsage(
  subject: AiSubject,
  feature: AiFeature,
  limit: number,
  /** The address ceiling, for guests only. Null for a signed-in member. */
  ip?: { key: string; limit: number } | null,
): Promise<AiUsageReservation> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .rpc("reserve_ai_usage", {
        p_user_id: subject.userId,
        p_guest_id: subject.guestId,
        p_feature: feature,
        p_limit: limit,
        p_ip_key: ip?.key ?? null,
        p_ip_limit: ip?.limit ?? 0,
      })
      .single<{ allowed: boolean; used: number; remaining: number }>();

    if (functionMissing(error)) {
      // Pre-0145 database. A member can still be metered by the old counter.
      if (subject.kind !== "user") {
        console.error("[ai/usage] guest reserve needs migration 0145", { feature });
        return { allowed: false, used: 0, remaining: 0 };
      }
      console.warn("[ai/usage] falling back to the pre-0145 reserve signature", { feature });
      const legacy = await admin
        .rpc("reserve_ai_usage", { p_user_id: subject.userId, p_feature: feature, p_limit: limit })
        .single<{ allowed: boolean; used: number; remaining: number }>();
      if (legacy.error || !legacy.data) {
        console.error("[ai/usage] legacy reserve failed", { feature, code: legacy.error?.code });
        return { allowed: false, used: 0, remaining: 0 };
      }
      return { allowed: legacy.data.allowed, used: legacy.data.used, remaining: legacy.data.remaining };
    }

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
export async function consumeAiUsage(subject: AiSubject, feature: AiFeature): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("consume_ai_usage", {
      p_user_id: subject.userId,
      p_guest_id: subject.guestId,
      p_feature: feature,
    });

    // See the block above reserveAiUsage: the schema may not have caught up yet.
    if (functionMissing(error)) {
      if (subject.kind !== "user") return false;
      const legacy = await admin.rpc("consume_ai_usage", {
        p_user_id: subject.userId,
        p_feature: feature,
      });
      return legacy.data === true;
    }

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
  subject: AiSubject,
  feature: AiFeature,
  dailyLimit: number,
): Promise<AiUsageRelease> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .rpc("release_ai_usage", {
        p_user_id: subject.userId,
        p_guest_id: subject.guestId,
        p_feature: feature,
        p_max_releases: releaseCapFor(dailyLimit),
      })
      .single<{ released: boolean; reserved: number }>();

    /*
      🔴 A REFUND MUST SURVIVE THE WINDOW. If the schema has not caught up and
      this simply failed, a member whose job broke through no fault of theirs
      would keep the charge — the one outcome this function exists to prevent.
    */
    if (functionMissing(error)) {
      if (subject.kind !== "user") return { released: false, reserved: 0 };
      const legacy = await admin
        .rpc("release_ai_usage", {
          p_user_id: subject.userId,
          p_feature: feature,
          p_max_releases: releaseCapFor(dailyLimit),
        })
        .single<{ released: boolean; reserved: number }>();
      if (legacy.error || !legacy.data) return { released: false, reserved: 0 };
      return { released: legacy.data.released, reserved: legacy.data.reserved };
    }

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
export interface AiUsageState {
  usedToday: number;
  /** True once a DAY-scoped rewarded ad has unlocked this feature today. */
  dayUnlocked: boolean;
}

export async function peekAiUsage(subject: AiSubject, feature: AiFeature): Promise<AiUsageState> {
  try {
    const admin = createAdminClient();
    /*
      🔴 UTC, matching `(now() at time zone 'utc')::date` in the SQL functions.
      `toISOString` is always UTC, so this cannot drift with the server's
      timezone — and a display that disagreed with the counter about which day
      it is would show somebody a spent allowance they still had, or the
      reverse. One clock for the whole product; see the brief's daily-reset
      rule ("Do not rely exclusively on the user's device clock").
    */
    const today = new Date().toISOString().slice(0, 10);
    const read = async (columns: string) => {
      let q = admin.from("ai_usage_daily").select(columns).eq("feature", feature).eq("usage_date", today);
      q = subject.kind === "user" ? q.eq("user_id", subject.userId) : q.eq("guest_id", subject.guestId);
      return q.maybeSingle();
    };

    let { data, error } = await read("reserved_jobs, reward_unlocked_at");

    /*
      Pre-0145 the extra column — and the guest one — do not exist, and asking
      for a missing column fails the WHOLE query rather than returning a null
      field. A display value must degrade to a number, never to an error.
    */
    if (error && /column .* does not exist|reward_unlocked_at|guest_id/i.test(error.message ?? "")) {
      if (subject.kind !== "user") return { usedToday: 0, dayUnlocked: false };
      ({ data, error } = await read("reserved_jobs"));
    }

    if (error || !data) return { usedToday: 0, dayUnlocked: false };

    // A dynamic `select()` string widens PostgREST's inferred row type, so the
    // two fields are read through a narrow local shape rather than asserted.
    const row = data as unknown as { reserved_jobs?: number | null; reward_unlocked_at?: string | null };
    return {
      usedToday: typeof row.reserved_jobs === "number" ? row.reserved_jobs : 0,
      dayUnlocked: !!row.reward_unlocked_at,
    };
  } catch {
    return { usedToday: 0, dayUnlocked: false };
  }
}

/**
 * Record that a day-scoped rewarded ad was watched.
 *
 * Grants NO allowance — see `unlock_ai_day` in migration 0145. It records a
 * permission, so replaying it can only re-state something already true and can
 * never buy a generation past the cap.
 */
export async function unlockAiDay(subject: AiSubject, feature: AiFeature): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("unlock_ai_day", {
      p_user_id: subject.userId,
      p_guest_id: subject.guestId,
      p_feature: feature,
    });
    if (functionMissing(error)) {
      // Nothing to stamp yet. Paid plans no longer use a day unlock at all
      // (see lib/ai/policy.ts), so this is inert rather than degraded.
      console.warn("[ai/usage] day unlock needs migration 0145", { feature });
      return false;
    }
    if (error) {
      console.error("[ai/usage] day unlock failed", { feature, code: error.code, message: error.message });
      return false;
    }
    return true;
  } catch (e) {
    console.error("[ai/usage] day unlock threw", { feature, error: String(e) });
    return false;
  }
}
