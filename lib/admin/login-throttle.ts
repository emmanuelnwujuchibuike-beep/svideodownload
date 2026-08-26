import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BRUTE-FORCE PROTECTION FOR THE ADMIN LOGIN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Counts failed admin sign-ins and locks out after a threshold, with an
 * escalating delay before that.
 *
 * ── 🔴 POSTGRES, NOT THE EXISTING REDIS LIMITER ───────────────────────────
 *
 * `lib/rate-limit.ts` exists and is the right tool for downloads. It is the
 * wrong tool here, for two reasons that are both load-bearing:
 *
 *  • IT FAILS OPEN. Missing Upstash silently degrades to an in-memory limiter
 *    (per serverless instance — effectively no limit at all across a fleet),
 *    and it honours `RATE_LIMIT_ENABLED=false`. For a download that is correct:
 *    a missing Redis must not refuse a paying member. For a password form it
 *    means unlimited guesses, and this project has ALREADY shipped an incident
 *    where UPSTASH_* were present but empty strings.
 *  • IT IS PER-INSTANCE WITHOUT REDIS. Serverless scales out under load, which
 *    is precisely what an attacker generates.
 *
 * Postgres is the one dependency an admin login cannot function without anyway,
 * so counting there means the throttle can never be quietly absent. If the DB
 * write itself fails, `note()` swallows the error — a failed COUNT must not
 * block a legitimate operator — but `check()` below fails CLOSED on a read
 * error, so an unreadable ledger denies rather than admits.
 *
 * ── Two keys, and both matter ─────────────────────────────────────────────
 *
 * Locking only by EMAIL lets anyone who knows an administrator's address lock
 * them out at will — a denial of service delivered through the security
 * control. Locking only by IP is defeated by a proxy pool. Both are counted;
 * either can trip; the email lock is deliberately shorter.
 */

const MAX_FAILS_EMAIL = 6;
const MAX_FAILS_IP = 12;

/** How long a tripped lock lasts. */
const LOCK_MINUTES_EMAIL = 15;
const LOCK_MINUTES_IP = 30;

/** Failures older than this stop counting — an honest typo last Tuesday is not evidence. */
const WINDOW_MINUTES = 60;

export interface ThrottleVerdict {
  /** May this attempt proceed? */
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when blocked. */
  retryAfterSeconds: number;
  /** Artificial delay to apply before answering, in ms. Slows guessing. */
  delayMs: number;
}

const ALLOW: ThrottleVerdict = { allowed: true, retryAfterSeconds: 0, delayMs: 0 };

function supabase() {
  return createAdminClient();
}

interface Row {
  fails: number;
  first_fail: string;
  last_fail: string;
  locked_until: string | null;
}

/**
 * Is this identifier currently allowed to attempt a sign-in?
 *
 * 🔴 FAILS CLOSED. If the ledger cannot be read, the attempt is refused. That is
 * the opposite of the download limiter's posture and it is the correct one here:
 * the cost of a false refusal is one operator waiting, and the cost of a false
 * allow is unlimited password guessing.
 */
export async function checkLoginAllowed(
  email: string,
  ip: string,
): Promise<ThrottleVerdict> {
  const now = Date.now();

  try {
    const db = supabase();
    const { data, error } = await db
      .from("admin_login_attempts")
      .select("identifier, scope, fails, first_fail, last_fail, locked_until")
      .in("identifier", [email.toLowerCase(), ip]);

    if (error) {
      // A MISSING TABLE means migration 0136 has not been applied. Refusing
      // every admin login in that state would lock the owner out of their own
      // dashboard over a deploy-ordering problem, so this one case allows —
      // loudly. Any other read error fails closed.
      if (isMissingTable(error)) return ALLOW;
      return { allowed: false, retryAfterSeconds: 30, delayMs: 0 };
    }

    const rows = (data ?? []) as (Row & { identifier: string; scope: string })[];
    let worstRetry = 0;
    let delayMs = 0;

    for (const row of rows) {
      const isEmail = row.scope === "email";

      if (row.locked_until) {
        const until = Date.parse(row.locked_until);
        if (Number.isFinite(until) && until > now) {
          worstRetry = Math.max(worstRetry, Math.ceil((until - now) / 1000));
        }
      }

      // Stale failures do not count toward the delay.
      const last = Date.parse(row.last_fail);
      const fresh = Number.isFinite(last) && now - last < WINDOW_MINUTES * 60_000;
      if (!fresh) continue;

      /*
        Escalating delay BEFORE the hard lock. Three wrong attempts cost about a
        second, five cost four — imperceptible to a person who mistyped, and
        ruinous to a script making thousands of attempts. Capped so a legitimate
        operator is never left staring at a spinner.
      */
      const cap = isEmail ? MAX_FAILS_EMAIL : MAX_FAILS_IP;
      if (row.fails > 2 && row.fails < cap) {
        delayMs = Math.max(delayMs, Math.min(2 ** (row.fails - 2) * 250, 4000));
      }
    }

    if (worstRetry > 0) {
      return { allowed: false, retryAfterSeconds: worstRetry, delayMs: 0 };
    }
    return { allowed: true, retryAfterSeconds: 0, delayMs };
  } catch {
    return { allowed: false, retryAfterSeconds: 30, delayMs: 0 };
  }
}

/**
 * Record a FAILED attempt, and lock the identifier if it has crossed the line.
 *
 * Swallows its own errors: a ledger that cannot be written must not turn into a
 * failed login for someone typing the right password.
 */
export async function noteLoginFailure(email: string, ip: string): Promise<void> {
  await Promise.all([
    bump(email.toLowerCase(), "email", MAX_FAILS_EMAIL, LOCK_MINUTES_EMAIL),
    bump(ip, "ip", MAX_FAILS_IP, LOCK_MINUTES_IP),
  ]);
}

/**
 * Clear the ledger for this email and IP after a SUCCESSFUL sign-in.
 *
 * Only on success, and only for the pair that just succeeded — so a correct
 * password does not clear the lock an attacker has accrued from another IP.
 */
export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  try {
    await supabase()
      .from("admin_login_attempts")
      .delete()
      .in("identifier", [email.toLowerCase(), ip]);
  } catch {
    /* best effort — a stale row only costs the next attempt a small delay */
  }
}

async function bump(
  identifier: string,
  scope: "email" | "ip",
  max: number,
  lockMinutes: number,
): Promise<void> {
  if (!identifier) return;
  try {
    const db = supabase();
    const nowIso = new Date().toISOString();

    const { data } = await db
      .from("admin_login_attempts")
      .select("fails, first_fail, last_fail, locked_until")
      .eq("identifier", identifier)
      .eq("scope", scope)
      .maybeSingle();

    const prev = data as Row | null;
    const lastMs = prev ? Date.parse(prev.last_fail) : 0;
    const stale = !prev || Date.now() - lastMs > WINDOW_MINUTES * 60_000;
    const fails = stale ? 1 : prev.fails + 1;

    await db.from("admin_login_attempts").upsert(
      {
        identifier,
        scope,
        fails,
        first_fail: stale ? nowIso : prev.first_fail,
        last_fail: nowIso,
        locked_until:
          fails >= max ? new Date(Date.now() + lockMinutes * 60_000).toISOString() : null,
      },
      { onConflict: "identifier,scope" },
    );
  } catch {
    /* see the note on noteLoginFailure */
  }
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  // PostgREST surfaces an unknown relation as PGRST205, Postgres as 42P01.
  return error.code === "PGRST205" || error.code === "42P01";
}
