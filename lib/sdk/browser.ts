"use client";

import { createClient } from "@/lib/supabase/client";

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
  const supabase = createClient();
  instance = new FrenzsaveClient({
    baseUrl: typeof window !== "undefined" ? window.location.origin : "",
    client: "web",
    getToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  });
  return instance;
}
