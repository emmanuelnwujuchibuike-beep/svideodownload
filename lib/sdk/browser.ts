"use client";

import { getClient } from "@/lib/supabase/client-lazy";

import { FrenzsaveClient } from "./client";

/**
 * The web app's shared FrenzsaveClient instance.
 *
 * Same SDK the native/desktop apps use, configured for the browser: base URL is
 * the current origin, and the Supabase access token is attached as a bearer so
 * requests authenticate even on surfaces where the cookie isn't refreshed (and
 * so the exact same code path is exercised as on native).
 */
let instance: FrenzsaveClient | null = null;

export function getApi(): FrenzsaveClient {
  if (instance) return instance;
  instance = new FrenzsaveClient({
    baseUrl: typeof window !== "undefined" ? window.location.origin : "",
    client: "web",
    /* The lazy door (2026-10-16): getToken is async anyway, so Supabase (~61 kB gz)
       arrives on the first API call instead of in every route that holds the SDK. */
    getToken: async () => {
      const { data } = await (await getClient()).auth.getSession();
      return data.session?.access_token ?? null;
    },
  });
  return instance;
}

/**
 * React hook returning the shared web client. Prefer this in components/features
 * so the web exercises the exact same SDK path (dedupe, retry, auth, timeouts) as
 * the native/desktop apps — one code path, app-fast everywhere.
 */
export function useApi(): FrenzsaveClient {
  return getApi();
}
