"use client";

import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;

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
 */
export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
