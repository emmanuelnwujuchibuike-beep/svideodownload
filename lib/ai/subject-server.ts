import "server-only";

import { cookies } from "next/headers";

import {
  AI_SUBJECT_COOKIE,
  AI_SUBJECT_COOKIE_MAX_AGE,
  guestSubject,
  ipCeilingKey,
  mintGuestToken,
  readGuestToken,
  userSubject,
  type AiSubject,
} from "@/lib/ai/subject";
import type { AiFeature } from "@/lib/ai/jobs";
import { clientId } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  RESOLVING WHO IS ASKING, on the server, every time
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One function that every AI route calls, so no route has to decide for itself
 * what a signed-out visitor is. The rules it encodes are the owner's, and the
 * order matters:
 *
 *   1. a Supabase session wins — a signed-in member is never a guest;
 *   2. failing that, a SIGNED guest cookie we issued;
 *   3. failing that, a fresh identity is minted and must be set on the response.
 *
 * ── 🔴 RULE 2b: A LINKED GUEST IS THE MEMBER, SIGNED IN OR NOT ──────────────
 *
 *   "if a signed-in Free user logs out, they should not receive another fresh
 *    guest allowance for the same day."
 *
 * So a guest identifier that has ever been claimed by an account resolves to
 * that account forever. Logging out changes what the interface shows; it does
 * not change whose allowance this browser spends. Without this, "log out" would
 * be a one-click way to double every limit in the product.
 *
 * The mirror case — signing UP with usage already spent — is handled by
 * `link_ai_guest` folding the day across at the moment of the link. Both halves
 * are one mechanism; see the migration.
 */

/** Where a freshly minted identity has to be written by the caller. */
/**
 * 🔴 THE STANDING RULE, AS A CONSTANT SO IT CAN BE CITED RATHER THAN RECALLED.
 *
 * Owner, 2026-09-09: "Frenz AI is a signed-in-user-only feature… This
 * distinction must remain true for all future AI features unless explicitly
 * changed by the product owner."
 *
 * Every future AI tool inherits the gate by calling `resolveAiSubject` and
 * refusing a null subject. There is deliberately no per-feature override.
 */
export const AI_REQUIRES_SIGN_IN = true;

export interface AiSubjectResolution {
  /**
   * Who is asking, or NULL when nobody is signed in.
   *
   * 🔴 Nullable as of 2026-09-09. It was always an `AiSubject` — a member or a
   * minted guest — and making it nullable is what forces every caller to be
   * re-examined by the compiler rather than by memory. A route that forgot to
   * handle the anonymous case now fails the build instead of quietly serving
   * one.
   */
  subject: AiSubject | null;
  /**
   * Set when a new guest identity was minted and the response MUST carry it.
   *
   * Returned rather than written here because `cookies().set()` only works in a
   * Route Handler or Server Action — a Server Component render throws. Handing
   * the value back lets the one place that can write it do so, and makes it
   * impossible to silently mint an identity that never reaches the browser.
   */
  setCookie?: { name: string; value: string; maxAge: number };
  /** The per-address ceiling key, or null for a signed-in member. */
  ipKey: string | null;
}

/**
 * The subject for this request.
 *
 * `feature` is needed because linking folds THAT feature's day across — the
 * allowances are per-feature (see lib/ai/policy.ts), so a global fold would
 * move counts between tools that never shared a counter.
 */
export async function resolveAiSubject(
  request: Request,
  feature: AiFeature,
): Promise<AiSubjectResolution> {
  const jar = await cookies();
  const cookieValue = jar.get(AI_SUBJECT_COOKIE)?.value ?? null;
  // 🔴 Verified, not trusted. An edited or invented cookie fails the HMAC and
  // is treated as absent — so the worst a visitor can do to their own
  // identifier is throw it away, which they could do anyway.
  const guestId = readGuestToken(cookieValue);

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anonymous */
  }

  /* ── 1 · signed in ── */
  if (userId) {
    if (guestId) {
      /*
        Claim the browser. Cheap (a primary-key insert that usually does
        nothing) and it must happen BEFORE the allowance is read, or a member
        who just signed up would see a fresh two for one request — which is
        exactly long enough to spend them.
      */
      try {
        await createAdminClient().rpc("link_ai_guest", {
          p_user_id: userId,
          p_guest_id: guestId,
          p_feature: feature,
        });
      } catch (e) {
        // A failed link must not block a signed-in member from using the
        // product. It re-runs on their next request.
        console.error("[ai/subject] link failed", { error: String(e) });
      }
    }
    return { subject: userSubject(userId), ipKey: null };
  }

  /* ── 2 · a guest we have seen before ── */
  if (guestId) {
    const owner = await linkedOwner(guestId);
    /*
      2b — signed out, but this browser belongs to an account.

      🔴 STILL HONOURED, AND IT IS NOT A LOOPHOLE. This does not grant AI access
      to a signed-out visitor: `subject` is a USER subject, so every route below
      still requires a session of its own before it will do anything (see the
      note on `AI_REQUIRES_SIGN_IN`). What it preserves is the LINK, so a
      member's old guest identifier keeps spending their allowance rather than
      resurfacing as a fresh one if they sign in again on this browser.
    */
    if (owner) return { subject: userSubject(owner), ipKey: null };
  }

  /*
    ── 🔴 3 · NOBODY IS SIGNED IN, AND THAT IS NOW THE END OF IT ──────────────

    Owner, 2026-09-09, as a PERMANENT product rule: "Frenz AI is a
    signed-in-user-only feature… Only authenticated/signed-in users can access
    Frenz AI. Logged-out users must not be able to open or use AI tools."

    This branch used to MINT a guest identity, and everything downstream —
    quota, jobs, storage, history — was built to work for one. That was correct
    under the previous rule ("Do not force users to sign up before they can try
    the AI") and it is exactly what the new rule reverses.

    🔴 REFUSED HERE, IN THE ONE PLACE IDENTITY IS DECIDED. Every AI route in the
    product calls this function before it does anything else, so a single return
    closes the whole surface — the create route, start, cancel, result, source,
    poster, the history list and the entitlement read. A gate in the page
    components would have left every one of those API routes open, and §21 is
    explicit that "the backend must independently enforce" it.

    ⚠️ THE GUEST MACHINERY IS DELIBERATELY LEFT IN PLACE, not deleted. The
    signed cookie, `ai_guest_links`, `guestSubject` and the guest columns on
    `ai_jobs` are all still here and still correct, because rows created under
    the old rule still exist and must keep resolving to their owner (branch 2b
    above). Ripping them out would orphan real members' finished videos to save
    code that costs nothing while unreachable.

    No cookie is minted any more, so a visitor who has never used Frenz AI is
    given no identifier at all — which is also the right answer for the AdSense
    crawler and for anyone who simply lands on the page.
  */
  return { subject: null, ipKey: null };
}

/** The account a guest identifier was claimed by, if any. */
async function linkedOwner(guestId: string): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("ai_guest_links")
      .select("user_id")
      .eq("guest_id", guestId)
      .maybeSingle();
    // 🔴 A PostgREST failure resolves as `{ error }` rather than throwing.
    // Treating it as "not linked" would hand a fresh allowance to a member who
    // signed out during a database hiccup — so it is logged and refused.
    if (error) {
      console.error("[ai/subject] link lookup failed", { code: error.code });
      return null;
    }
    return (data?.user_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply a minted identity to a response.
 *
 * `httpOnly` is the property the whole design rests on: no script on the page
 * — ours, an ad network's, or an injected one — can read or copy this value.
 * `sameSite: lax` so it survives an ordinary navigation from a search result,
 * which is how most guests will arrive.
 */
export function applyAiSubjectCookie(response: Response, resolution: AiSubjectResolution): Response {
  if (!resolution.setCookie) return response;
  const { name, value, maxAge } = resolution.setCookie;
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  response.headers.append("Set-Cookie", parts.join("; "));
  return response;
}
