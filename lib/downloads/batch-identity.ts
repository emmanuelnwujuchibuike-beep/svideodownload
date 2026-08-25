import "server-only";

import {
  anonCookie,
  isSecureRequest,
  mintAnonId,
  readAnonId,
} from "@/lib/streaks/identity";

/**
 * Who a Multi-Link batch allowance belongs to.
 *
 * ── Anonymous visitors are identified by the BROWSER (owner, 2026-08-25:
 *    "anonymous users too should have the limit with the browser" →
 *    "browser id and local storage so it doesnt glitch on anonymous users") ──
 *
 * Two channels, in priority order:
 *
 *  1. The server-minted httpOnly cookie (`frenz_sid`) — the SAME one the streak
 *     system already uses, not a second identity invented for this. It is
 *     created by the server, unreadable and unwritable from JavaScript, sent on
 *     every request (so several tabs and a PWA relaunch are one identity) and
 *     survives a restart. This is the authoritative channel.
 *
 *  2. A localStorage mirror the client sends back when the cookie is missing.
 *     This is the "doesn't glitch" half: a visitor whose cookie was dropped —
 *     ITP capping a non-Secure cookie's lifetime, a PWA relaunching with a cold
 *     cookie jar, an over-eager privacy extension — would otherwise appear
 *     brand new and silently get a fresh allowance, and their remaining count
 *     would jump back to full in front of them. The mirror carries the same id
 *     across that gap, and the response re-plants the cookie.
 *
 * Why the browser rather than the IP: a mobile carrier NATs thousands of people
 * onto one address and a café shares one between everyone in it, so an IP-keyed
 * allowance makes strangers spend each other's. The IP hash is still recorded
 * on the row for a future abuse control, but it is not the counting key.
 *
 * ── What this does NOT claim ──────────────────────────────────────────────
 * A client-supplied id is forgeable — someone can send a fresh UUID on every
 * request and get an unlimited allowance. That is exactly as true of clearing
 * cookies, which needs no tooling at all, so accepting the mirror gives up
 * nothing that was being protected. The cap is a product allowance for ordinary
 * visitors, not an anti-abuse boundary; the things that ARE security boundaries
 * (plan resolution, reward redemption, the source ceiling) never trust the
 * client at all.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BatchIdentity {
  userId: string | null;
  /** Null for a signed-in member — their account is the identity. */
  anonId: string | null;
  ip: string;
  /** Set when a cookie must be planted on the response. */
  setCookie: string | null;
  /** Echoed to the client so it can keep its localStorage mirror current. */
  mirrorId: string | null;
}

/**
 * Resolve a batch identity, minting and planting a browser id when needed.
 *
 * `clientAnonId` is the localStorage mirror, and is used ONLY when the request
 * carries no cookie — a present cookie always wins, so a client cannot displace
 * an identity the server already established.
 */
export function resolveBatchIdentity(input: {
  request: Request;
  userId: string | null;
  clientAnonId?: unknown;
}): BatchIdentity {
  const { request, userId } = input;
  const ip = clientIpOf(request);

  if (userId) {
    return { userId, anonId: null, ip, setCookie: null, mirrorId: null };
  }

  const fromCookie = readAnonId(request);
  if (fromCookie) {
    // Already established. Echo it so a client that lost its mirror can rebuild
    // one, but plant nothing — the cookie is already there.
    return { userId: null, anonId: fromCookie, ip, setCookie: null, mirrorId: fromCookie };
  }

  const mirrored =
    typeof input.clientAnonId === "string" && UUID_RE.test(input.clientAnonId)
      ? input.clientAnonId
      : null;
  const anonId = mirrored ?? mintAnonId();

  return {
    userId: null,
    anonId,
    ip,
    // Re-plant either way: a recovered mirror needs the cookie restored just as
    // much as a fresh id needs it created.
    setCookie: anonCookie(anonId, isSecureRequest(request)),
    mirrorId: anonId,
  };
}

/** First hop of x-forwarded-for, else x-real-ip. Mirrors `clientId` in lib/rate-limit. */
function clientIpOf(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "anonymous";
}

/** Attach the browser-id cookie to a response, when one needs planting. */
export function withBatchIdentity<T extends Response>(res: T, identity: BatchIdentity): T {
  if (identity.setCookie) res.headers.append("Set-Cookie", identity.setCookie);
  return res;
}
