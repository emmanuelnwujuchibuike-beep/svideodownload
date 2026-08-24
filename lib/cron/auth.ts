import { createHash, timingSafeEqual } from "node:crypto";

import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared authorisation for every /api/cron/* route.
 *
 * Three ways in, tried cheapest first:
 *
 *   1. `CRON_SECRET` env var — the original path, unchanged. Vercel Cron signs
 *      its own requests with this, so `trending` and `profile-snapshots` keep
 *      working exactly as before.
 *   2. A token whose SHA-256 lives in `settings.cron_token` — the DB-backed
 *      path. Mint it with `npm run cron:token`.
 *   3. An admin session — the "run it now from a browser" case.
 *
 * ── 🔴 WHY A DATABASE-BACKED TOKEN EXISTS AT ALL ────────────────────────────
 * An env var is only read at deploy time: adding one in the Vercel dashboard
 * does nothing until the project is redeployed, and a variable that is present
 * but EMPTY is indistinguishable from a wrong one from the outside — every
 * failure looks like the same opaque 403. That cost this project a lot of
 * time. The service-role key is already in the environment (the whole app
 * depends on it), so routing the cron credential through the database means
 * no new variable, no redeploy to rotate, and a check that can actually be
 * run and observed. The env path stays first so nothing that works today
 * changes behaviour.
 *
 * ── 🔴 WHY A HASH, NOT THE TOKEN ────────────────────────────────────────────
 * `settings` is admin-only under RLS (verified: service role sees rows, anon
 * sees none), but a credential that is never stored cannot be stolen from
 * storage. We keep SHA-256(token) and compare digests.
 *
 * Plain SHA-256 with no salt and no stretching is the RIGHT choice here and
 * would be badly wrong for a password. The input is 32 bytes of CSPRNG output,
 * so there is no dictionary to run and no low-entropy guess space for a slow
 * KDF to protect; all a KDF would add is latency on every cron call.
 *
 * ── 🔴 WHY THE DATABASE READ IS GUARDED ─────────────────────────────────────
 * These endpoints are public and unauthenticated. A lookup on every request
 * would let anyone drive database load by spraying the URL, so the read only
 * happens for a bearer long enough to plausibly BE a token, and the outcome is
 * cached in module scope for a minute. Consequence worth knowing: a freshly
 * minted token can take up to `CACHE_TTL_MS` to start working on an instance
 * that has already looked.
 */

/** Where the digest lives, and the shape a generated token has. */
const SETTINGS_KEY = "cron_token";
const TOKEN_BYTES = 32;
const DIGEST_RE = /^[0-9a-f]{64}$/;

/**
 * A bearer shorter than this never reaches the database. It is a load guard,
 * not a security check — the digest comparison below is what actually decides.
 */
const MIN_TOKEN_LENGTH = 16;

const CACHE_TTL_MS = 60_000;

let cache: { at: number; digest: string | null } | null = null;

/** The value stored in `settings.cron_token`. */
export type CronTokenRecord = { sha256: string; updated_at: string };

export function hashCronToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Number of random bytes a minted token carries. */
export const CRON_TOKEN_BYTES = TOKEN_BYTES;

/** The `settings` key the token digest is stored under. */
export const CRON_TOKEN_KEY = SETTINGS_KEY;

/**
 * Constant-time digest comparison.
 *
 * Both sides are hashed before they get here, so they are always the same
 * length and `timingSafeEqual` can never throw on a length mismatch — which
 * is itself the point: comparing raw secrets of differing length leaks the
 * length through the exception path.
 */
function sameDigest(a: string, b: string): boolean {
  if (!DIGEST_RE.test(a) || !DIGEST_RE.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

async function storedDigest(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.digest;

  let digest: string | null = null;
  try {
    const { data } = await createAdminClient()
      .from("settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    const value = data?.value as Partial<CronTokenRecord> | null | undefined;
    if (typeof value?.sha256 === "string" && DIGEST_RE.test(value.sha256)) {
      digest = value.sha256;
    }
  } catch {
    // Unreachable database — deny, and cache the denial like any other answer.
    // The sweep itself could not have done any work in this state anyway, and
    // an uncached failure would let one outage turn into a query storm.
    digest = null;
  }

  cache = { at: Date.now(), digest };
  return digest;
}

/** Test seam: drop the memoised digest. */
export function resetCronTokenCache(): void {
  cache = null;
}

/** True when the caller may run a cron route. */
export async function cronAuthorized(request: Request): Promise<boolean> {
  const presented = bearer(request);

  if (presented) {
    const configured = process.env.CRON_SECRET;
    // Hashing both sides normalises length, so a wrong-length guess costs the
    // same as a right-length one.
    if (configured && sameDigest(hashCronToken(presented), hashCronToken(configured))) {
      return true;
    }

    if (presented.length >= MIN_TOKEN_LENGTH) {
      const digest = await storedDigest();
      if (digest && sameDigest(hashCronToken(presented), digest)) return true;
    }
  }

  return !!(await getAdminUser());
}
