"use client";

import { getMemoizedClient, setMemoizedClient, type BrowserClient } from "./client-instance";
import { SUPABASE_COOKIE_OPTIONS } from "./cookie-options";

/**
 * The browser Supabase client, loaded ON DEMAND rather than in the entry bundle.
 *
 * Identical to `./client`'s `createClient()` in every respect except WHEN the
 * library arrives: the `import()` below is a split point, so `@supabase/ssr`
 * (and the gotrue/postgrest/realtime code it pulls) is fetched the first time
 * something actually needs a session — not before React can hydrate the page.
 * See `./client-instance` for the measurement that motivated this and for why
 * the memo is shared with the synchronous door.
 *
 * ── Use this from anything on a first-paint path ─────────────────────────────
 *
 * The four modules the landing page reaches — `features/auth/use-user`,
 * `lib/auth/sign-out`, `features/social/inbox`, `features/history/sync` — all
 * touch Supabase from inside an effect or an `async` function, i.e. never
 * during render, so awaiting it costs them nothing. `useUser()` in particular
 * already starts every visitor at signed-out and corrects asynchronously, so a
 * client that arrives a moment later is indistinguishable from one that was
 * bundled eagerly.
 *
 * Keep using the synchronous `./client` where Supabase IS the page (messaging,
 * the composer, account settings): those routes need the library immediately,
 * splitting it there would only add a round trip, and `cookieOptions` below
 * must stay identical to that one's — see `./cookie-options` for what a
 * mismatched flag silently downgrades.
 */
export async function getClient(): Promise<BrowserClient> {
  const existing = getMemoizedClient();
  if (existing) return existing;

  const { createBrowserClient } = await import("@supabase/ssr");

  // Re-check: two callers can await the same import concurrently, and whoever
  // resolves second must not build a second client (and a second socket).
  return (
    getMemoizedClient() ??
    setMemoizedClient(
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookieOptions: SUPABASE_COOKIE_OPTIONS },
      ),
    )
  );
}
