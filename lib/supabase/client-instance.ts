"use client";

import type { createBrowserClient } from "@supabase/ssr";

/**
 * The ONE browser Supabase client for the tab — and nothing else.
 *
 * ── Why this module exists at all ────────────────────────────────────────────
 *
 * `@supabase/ssr` + gotrue + postgrest + realtime measure **60.2 kB gzipped**
 * on the landing page's first-load bundle (47.2 kB in the `@supabase` chunk,
 * 13.0 kB in the gotrue one) — 22% of a 275 kB ceiling that currently has
 * ~3 kB of headroom. None of it is needed to make the Download button work,
 * yet every byte had to arrive, parse and evaluate before React could hydrate
 * the page, because `lib/supabase/client.ts` imports `createBrowserClient` at
 * module scope and four modules on the landing's critical path import THAT.
 *
 * So there are now two doors to the same client: the synchronous
 * `./client` (unchanged, ~30 call sites on pages where Supabase is the point)
 * and the deferred `./client-lazy`, whose `getClient()` pulls the library with
 * a dynamic `import()` and therefore keeps it out of the entry bundle.
 *
 * ── Why the memo lives HERE and not in either of them ────────────────────────
 *
 * Both doors must hand back the SAME instance. `client.ts`'s own note explains
 * why in detail: every call site used to construct its own client, and each one
 * opened its own Realtime WebSocket, so entering and leaving a chat a few times
 * leaked a socket per visit until the messages page hung on "connecting".
 *
 * If `client-lazy.ts` imported the memo from `client.ts` it would statically
 * pull `@supabase/ssr` straight back into the entry bundle and undo the whole
 * change. A third module that both can import, holding only a variable, is what
 * keeps the two doors sharing one instance without either one depending on the
 * library.
 *
 * 🔴 KEEP THIS MODULE FREE OF RUNTIME IMPORTS. The `import type` above is erased
 * at compile time and costs nothing; a value import of `@supabase/ssr` here
 * would put the library back on every page that reaches either door.
 */
export type BrowserClient = ReturnType<typeof createBrowserClient>;

let client: BrowserClient | undefined;

/** The already-constructed client for this tab, or `undefined` if none yet. */
export function getMemoizedClient(): BrowserClient | undefined {
  return client;
}

/**
 * Memoizes `c` as the tab's client and returns it.
 *
 * Last writer wins, but both callers check `getMemoizedClient()` first, so the
 * only way to reach this twice is two constructions racing — and `client.ts`'s
 * path is synchronous, so at most one of them can be mid-flight.
 */
export function setMemoizedClient(c: BrowserClient): BrowserClient {
  client = c;
  return client;
}
