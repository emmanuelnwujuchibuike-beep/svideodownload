"use client";

import { useEffect, useState } from "react";

import { readIdentity, writeIdentity } from "@/lib/auth/identity-cache";
import type { BillingPlan } from "@/lib/monetization/types";

/**
 * Single source of the current visitor's plan/entitlements on the client.
 * Fetches `/api/me` once and memoises it process-wide so badges, premium UI and
 * gating don't each hit the endpoint. Optimistic default: free, not premium.
 */
export interface Entitlements {
  plan: BillingPlan;
  isPremium: boolean;
  isBusiness: boolean;
  showAds: boolean;
  handle: string | null;
  /** The real Frenz profile picture (profiles.avatar_url) — NOT the auth record's own user_metadata.avatar_url, which is only ever set by an OAuth provider and can be stale/absent even when a real profile picture is set. */
  avatarUrl: string | null;
  ready: boolean;
}

const FREE: Omit<Entitlements, "ready"> = {
  plan: "free",
  isPremium: false,
  isBusiness: false,
  showAds: true,
  handle: null,
  avatarUrl: null,
};

let cache: Omit<Entitlements, "ready"> | null = null;
let inflight: Promise<void> | null = null;

/**
 * Whether a Supabase auth cookie is present.
 *
 * ── Why this is worth a synchronous check ─────────────────────────────────────
 *
 * A signed-out visitor cannot be premium, so their entitlements are knowable
 * without asking the server: free, ads on. The `/api/me` round trip to Paris
 * (200-300 ms) is pure latency for them, and it is the gate every ad component
 * waits on before it will render — so skipping it is most of why ads showed up
 * late for the visitors who see the most of them (signed-out downloader
 * traffic).
 *
 * The cookie is deliberately readable from JS (see `cookie-options.ts` — the
 * browser Supabase client needs it), so this is a real, cheap signal. It only
 * ever SKIPS the fetch when the cookie is absent; any cookie at all falls
 * through to the authoritative `/api/me`, so a stale or malformed cookie cannot
 * hide a real plan.
 */
function hasAuthCookie(): boolean {
  if (typeof document === "undefined") return true; // assume signed-in on the server; the effect re-checks
  return /(^|;\s*)sb-[^=]*-auth-token/.test(document.cookie);
}

export function useEntitlements(): Entitlements {
  const [value, setValue] = useState<Omit<Entitlements, "ready">>(cache ?? FREE);
  const [ready, setReady] = useState<boolean>(cache !== null);

  // Paint the last-known handle/avatar immediately on a COLD start (a relaunched
  // PWA has an empty module cache, so the profile button otherwise renders a
  // placeholder until /api/me answers — owner, 2026-07-16: "the bottom nav
  // profile button still reloads on back swiped"). Identity only: `plan`/
  // `showAds` stay at the FREE default until the real fetch lands, so a stale
  // disk value can never hide an ad. `ready` is deliberately NOT set from this —
  // gating logic still waits for the truth; only the pixels come early.
  useEffect(() => {
    if (cache !== null) return;
    const seed = readIdentity();
    if (seed) setValue((v) => (v.handle || v.avatarUrl ? v : { ...v, ...seed }));
  }, []);

  useEffect(() => {
    if (cache !== null) {
      setValue(cache);
      setReady(true);
      return;
    }
    /*
      Signed-out fast path: no auth cookie means no session means free, resolved
      here without a round trip. Every ad component gates on `ready`, so this is
      what lets an ad render as soon as the page hydrates instead of one
      Paris round trip later.
    */
    if (!hasAuthCookie()) {
      cache = FREE;
      setValue(FREE);
      setReady(true);
      return;
    }

    let alive = true;
    inflight ??= fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const plan = (d?.plan as BillingPlan) ?? "free";
        cache = {
          plan,
          isPremium: plan !== "free",
          isBusiness: plan === "business",
          showAds: d?.showAds ?? true,
          handle: (d?.handle as string | null) ?? null,
          avatarUrl: (d?.avatarUrl as string | null) ?? null,
        };
        // Persist identity for the next cold start's first frame.
        writeIdentity({ handle: cache.handle, avatarUrl: cache.avatarUrl });
      })
      .catch(() => {
        cache = FREE;
      })
      .finally(() => {
        inflight = null;
      });

    void inflight.then(() => {
      if (alive && cache) {
        setValue(cache);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return { ...value, ready };
}
