"use client";

import { useEffect } from "react";

import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";
import { readCookie } from "@/lib/dom/cookie";

/**
 * A member who arrived through a Frenzsave share link and signed up WITHOUT
 * passing through /auth/callback (that route claims it itself): if the
 * readable `frenz_ref_pending` flag is set, ask the server once to attribute
 * the sign-up (POST /api/referrals/claim — the token is in an httpOnly
 * cookie the server reads; nothing is sent from here). The server clears both
 * cookies, so this fires at most once. Renders nothing; no flag = no request.
 */
export function ReferralClaim() {
  useEffect(() => {
    // signed-out visitors keep the flag until they sign in — no request, no invocation, until then
    if (readCookie("frenz_ref_pending") !== "1" || !hasAuthCookie()) return;
    const t = window.setTimeout(() => {
      void fetch("/api/referrals/claim", { method: "POST", credentials: "same-origin" }).catch(() => null);
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
