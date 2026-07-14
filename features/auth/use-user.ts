"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Tracks the current Supabase user and updates on sign-in / sign-out. */
export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(hasSupabase);

  useEffect(() => {
    if (!hasSupabase) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    let active = true;

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
        if (active) {
          setUser(data.user);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading, enabled: hasSupabase };
}
