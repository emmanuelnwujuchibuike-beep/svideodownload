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
export interface AiSubjectResolution {
  subject: AiSubject;
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
    // 2b — signed out, but this browser belongs to an account. Spend theirs.
    if (owner) return { subject: userSubject(owner), ipKey: null };
    return { subject: guestSubject(guestId), ipKey: ipCeilingKey(clientId(request.headers)) };
  }

  /* ── 3 · brand new ── */
  const minted = mintGuestToken();
  return {
    subject: guestSubject(minted.id),
    setCookie: {
      name: AI_SUBJECT_COOKIE,
      value: minted.token,
      maxAge: AI_SUBJECT_COOKIE_MAX_AGE,
    },
    ipKey: ipCeilingKey(clientId(request.headers)),
  };
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
