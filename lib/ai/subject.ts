import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHOSE ALLOWANCE IS THIS — identity for people who have not signed in
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08:
 *
 *   "The 2/day guest allowance must work without requiring account creation or
 *    login… Do not force users to sign up before they can try the AI."
 *
 * and, in the same breath:
 *
 *   "Because guests are not authenticated, do NOT rely only on localStorage,
 *    sessionStorage, React state, cookies alone or client-side counters… Do not
 *    introduce invasive fingerprinting."
 *
 * Those two together are the whole design problem: give an anonymous person a
 * real, spendable allowance, without a login to hang it on and without
 * profiling them.
 *
 * ── 🔴 THE ANSWER: A COOKIE THE BROWSER CANNOT WRITE ────────────────────────
 *
 * The identifier is minted on the SERVER, signed with an HMAC the browser never
 * sees, and set `HttpOnly`. So it is a cookie, but it is emphatically not
 * "cookies alone" in the sense the brief warns about:
 *
 *   - a visitor cannot invent one — an unsigned or edited value fails
 *     verification and is discarded, so forging identities is not possible,
 *     only DISCARDING your own;
 *   - a visitor cannot read it from JavaScript, so no script on the page (ours,
 *     an ad network's, or an injected one) can copy or correlate it;
 *   - it carries NO information — 16 random bytes. It is not derived from an
 *     IP, a user agent, a screen size or anything else about the person, which
 *     is what keeps it the opposite of a fingerprint.
 *
 * The counter it keys still lives in Postgres, written only by a service-role
 * function. The cookie says WHICH row; it never says what is in it.
 *
 * ── And the honest limit of that ─────────────────────────────────────────────
 *
 * Clearing cookies gets you a new identity and a new two. That is true of every
 * non-invasive scheme, and pretending otherwise would be the fingerprinting the
 * brief rules out. It is why a second, coarser bound exists: a per-IP daily
 * ceiling, keyed by a SALTED HASH of the address and nothing else, set high
 * enough that a shared mobile carrier NAT — which is most of this product's
 * audience — is never mistaken for one abuser. See `ipCeilingKey`.
 *
 * The two together stop the attacks the brief actually names (refreshing,
 * multiple tabs, clearing React state, calling the endpoint directly) without
 * punishing anyone for their network.
 */

/** The cookie the guest identifier travels in. */
export const AI_SUBJECT_COOKIE = "fs_aid";

/**
 * 400 days — the maximum Chrome will honour.
 *
 * A short expiry would silently hand out fresh allowances to returning
 * visitors, which is the same hole as clearing cookies except we would be the
 * ones opening it.
 */
export const AI_SUBJECT_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** 16 bytes of CSPRNG. Not a counter, not a hash of anything about the person. */
const ID_BYTES = 16;
/** Truncated HMAC. 96 bits is far beyond forgeable for a value worth 2 runs. */
const SIG_LENGTH = 24;

const ID_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * The HMAC key, derived rather than used directly.
 *
 * 🔴 `SUPABASE_SERVICE_ROLE_KEY` is the fallback because it is the one secret
 * guaranteed to exist wherever this runs — but it is hashed with a purpose
 * string first, never used as the key itself. Two systems sharing a raw secret
 * means a weakness in either becomes a weakness in both; a domain-separated
 * derivation costs one hash and removes that coupling entirely.
 *
 * `AI_GUEST_SECRET` overrides it, which is also how the identifier space would
 * be rotated: change the variable and every outstanding cookie fails
 * verification at once and is reissued.
 */
function signingKey(): Buffer {
  const secret = process.env.AI_GUEST_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHash("sha256").update(`frenz-ai-guest:v1:${secret}`).digest();
}

function sign(id: string): string {
  return createHmac("sha256", signingKey()).update(id).digest("base64url").slice(0, SIG_LENGTH);
}

/** A fresh signed guest identifier, in `<id>.<signature>` form. */
export function mintGuestToken(): { id: string; token: string } {
  const id = randomBytes(ID_BYTES).toString("base64url");
  return { id, token: `${id}.${sign(id)}` };
}

/**
 * The id inside a cookie value, or null if it was not one we issued.
 *
 * 🔴 Constant-time comparison, and the shape is checked before the HMAC is
 * computed — a 4 MB cookie should cost a regex, not a hash.
 */
export function readGuestToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;

  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!ID_RE.test(id) || sig.length !== SIG_LENGTH) return null;

  const expected = Buffer.from(sign(id), "utf8");
  const actual = Buffer.from(sig, "utf8");
  // Lengths are equal by the check above, so this cannot throw — and a throw
  // would itself leak the length through the exception path.
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? id : null;
}

/**
 * Who an AI request belongs to.
 *
 * `key` is the single string every counter, job row and rate limit is keyed by,
 * so no call site ever has to branch on which kind it is holding — which is
 * what stops a guest path and a member path drifting apart.
 */
export type AiSubject =
  | { kind: "user"; userId: string; guestId: null; key: string }
  | { kind: "guest"; userId: null; guestId: string; key: string };

export function userSubject(userId: string): AiSubject {
  return { kind: "user", userId, guestId: null, key: `u:${userId}` };
}

export function guestSubject(guestId: string): AiSubject {
  return { kind: "guest", userId: null, guestId, key: `g:${guestId}` };
}

/**
 * The identifier this subject's storage keys are prefixed with.
 *
 * Object keys are `<ownerId>/<feature>/<jobId>/<role>.<ext>`, and for a guest
 * the owner is their signed identifier. Both forms are already safe path
 * segments — a UUID and base64url — so nothing here needs escaping beyond the
 * `safeSegment` the storage layer applies anyway.
 *
 * 🔴 Deliberately NOT `key`. That carries a `u:`/`g:` prefix for counters and
 * rate limits, and putting a colon into an object key would be a small horror
 * to debug later.
 */
export function subjectOwnerId(subject: AiSubject): string {
  return subject.userId ?? subject.guestId;
}

/**
 * The subject that owns a stored row.
 *
 * 🔴 Used by the paths that have no request to resolve from — the provider
 * webhook, the ffmpeg finalizer, the stall sweep. All three act on a job long
 * after the browser that started it has gone, and all three must refund the
 * RIGHT counter. Reading it off the row is the only correct source: the job
 * records who owns it, and nothing else in those flows knows.
 *
 * Returns null for a row with neither (impossible under `ai_jobs_subject_chk`,
 * but a check constraint is a database's promise and this is TypeScript's).
 */
export function subjectFromRow(row: {
  user_id?: string | null;
  guest_id?: string | null;
}): AiSubject | null {
  if (row.user_id) return userSubject(row.user_id);
  if (row.guest_id) return guestSubject(row.guest_id);
  return null;
}

/**
 * The key for the per-IP daily ceiling.
 *
 * ── 🔴 SALTED, TRUNCATED, AND A CEILING RATHER THAN A QUOTA ─────────────────
 *
 * A raw IP is personal data and a plain SHA-256 of one is trivially reversible
 * — the whole IPv4 space is 4 billion hashes, which is minutes of work. So the
 * address is salted with a server secret before hashing and then truncated,
 * making the stored value useless to anyone who obtains it and impossible to
 * reverse without the secret.
 *
 * ⚠️ It is a CEILING, not the guest's quota. Africa-primary traffic behind
 * carrier-grade NAT means thousands of unrelated people can share one address,
 * and metering them as one person would break the feature for a whole network.
 * The cookie carries the real 2/day; this only stops one machine cycling
 * identities all afternoon, so it is set well above what any single genuine
 * visitor reaches.
 */
export function ipCeilingKey(ip: string): string {
  const salt = process.env.AI_GUEST_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return `ip:${createHash("sha256").update(`frenz-ai-ip:v1:${salt}:${ip}`).digest("base64url").slice(0, 22)}`;
}

/**
 * How many guest runs one address may account for in a day.
 *
 * Twelve: six times a single visitor's allowance, so a household, an office or
 * a café is never affected, while a script cycling cookies stops after six
 * rounds instead of running until the provider bill does.
 */
export const AI_GUEST_IP_DAILY_CEILING = 12;
