"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getMemoizedClient, setMemoizedClient } from "./client-instance";
import { SUPABASE_COOKIE_OPTIONS } from "./cookie-options";

/**
 * Browser-side Supabase client (anon key, RLS enforced) — memoized to one
 * instance for the whole tab's lifetime, so it shares one underlying
 * Realtime WebSocket. Every call site used to get a brand-new client (and
 * therefore a brand-new socket): entering and leaving a chat thread several
 * times in a session leaked one open connection per visit, which eventually
 * left the messages page stuck "connecting" — a new subscribe on a fresh
 * socket queued behind sockets that were never torn down. Callers must still
 * pair every `.channel()` with `supabase.removeChannel(channel)` on cleanup
 * (not just `channel.unsubscribe()`) now that channels live on one shared
 * client rather than being thrown away with a whole client instance.
 *
 * ── The memo moved to ./client-instance (2026-08-31) ─────────────────────────
 * It is shared with `./client-lazy`, the deferred door that keeps
 * `@supabase/ssr` out of first-paint bundles. Both must return the SAME
 * instance or the socket leak described above comes straight back, one door at
 * a time. Nothing else about this function changed — importing it still pulls
 * the library eagerly, which is correct on the routes where Supabase is the
 * page. On a first-paint path, import `getClient` from `./client-lazy` instead.
 */
export function createClient() {
  return (
    getMemoizedClient() ??
    setMemoizedClient(
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        // Same flags the server and middleware write with — see
        // ./cookie-options.ts. This client refreshes the session too, so if it
        // wrote with different flags (notably a missing `Secure`) it would
        // silently DOWNGRADE the cookie the server had hardened, on the very
        // next token refresh.
        { cookieOptions: SUPABASE_COOKIE_OPTIONS },
      ),
    )
  );
}
