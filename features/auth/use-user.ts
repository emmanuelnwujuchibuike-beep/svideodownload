"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { clearIdentity } from "@/lib/auth/identity-cache";
import { getClient } from "@/lib/supabase/client-lazy";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Process-wide memo of the resolved user. `undefined` = never resolved yet in
 * this JS context; `null` = resolved to signed-out.
 *
 * Without this, EVERY mount of `useUser()` started at `loading: true` and hit
 * the network again — so the header's profile control re-rendered its grey
 * placeholder each time it remounted, which reads as the button "reloading"
 * (owner, 2026-07-16). `onAuthStateChange` below keeps this honest: a real
 * sign-in/sign-out updates it immediately, so a stale value can't outlive the
 * event that changed it.
 */
let cachedUser: User | null | undefined = undefined;

/** Tracks the current Supabase user and updates on sign-in / sign-out. */
export function useUser() {
  const [user, setUser] = useState<User | null>(cachedUser ?? null);
  const [loading, setLoading] = useState(hasSupabase && cachedUser === undefined);

  useEffect(() => {
    if (!hasSupabase) {
      setLoading(false);
      return;
    }
    let active = true;
    /*
      Held rather than returned directly: the client now ARRIVES ASYNCHRONOUSLY
      (`@supabase/ssr` is a dynamic import — see lib/supabase/client-lazy.ts),
      so React can run this cleanup before the subscription exists. Unsubscribing
      a `null` would throw and leave the listener attached for the tab's life, so
      the cleanup below unsubscribes whatever is here BY THEN, and the `active`
      flag makes a late arrival tear itself down immediately.
    */
    let subscription: { unsubscribe: () => void } | null = null;

    void getClient()
      .then((supabase) => {
        if (!active) return;

        // Real bug found 2026-07-14 (owner: "message page auto refreshes and
        // gets stuck in loading... now happening in all accounts"): this had no
        // `.catch()` — a real, confirmed browser race (a freshly-installed
        // service worker calling `clients.claim()` mid-fetch) can make this
        // throw a raw network `TypeError` on the very first load/reload, and
        // with no `.catch()` the `.then()` above never ran, so `loading` never
        // left `true`. `useUser()` is consumed by the app-wide header/topbar on
        // every authenticated page, so this single unhandled rejection could
        // stall chrome across the whole app. Fails open (not signed-in) rather
        // than hanging forever; `onAuthStateChange` below still corrects this
        // moments later if a real session exists.
        supabase.auth
          .getUser()
          .then(({ data }) => {
            cachedUser = data.user;
            if (active) {
              setUser(data.user);
              setLoading(false);
            }
          })
          .catch(() => {
            // Deliberately does NOT populate `cachedUser` — a network failure is
            // not an answer, and memoising it as "signed out" would make a
            // transient blip stick for the rest of the session.
            if (active) setLoading(false);
          });

        subscription = supabase.auth.onAuthStateChange((_event, session) => {
          cachedUser = session?.user ?? null;
          if (!cachedUser) clearIdentity();
          setUser(cachedUser);
          setLoading(false);
        }).data.subscription;
      })
      .catch(() => {
        // The chunk itself failed to load (offline, or a stale hashed asset
        // after a deploy). Same contract as the `getUser()` failure above:
        // fail open to signed-out instead of leaving the header spinning.
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  return { user, loading, enabled: hasSupabase };
}
