"use client";

import { useEffect, useState } from "react";

/**
 * `useFlag` — read a `clientReadable` feature flag from a Client Component.
 *
 * The server-only store (`./flags-store`) can't run on the client and the static
 * root layout can't read a runtime flag without un-static-ing every route, so a
 * client surface reads its flag through `GET /api/flags` instead. This hook is the
 * consumer side of that endpoint.
 *
 * ── Opt-in, so it costs nothing until used ────────────────────────────────────
 *
 * The fetch fires lazily on first `useFlag` mount and is memoised for the session,
 * so a page with no flag consumer makes no request, and N consumers on a page share
 * ONE request. This is what keeps flags off the hot path of pages that don't need
 * them — per the Constitution's load-time guarantee.
 *
 * ── SSR-safe ──────────────────────────────────────────────────────────────────
 *
 * The first render always returns `fallback` (no network, no `window`), then
 * updates once the fetch resolves. Default your flags OFF and a gated feature
 * simply appears after load rather than flashing — progressive enhancement, no
 * hydration mismatch.
 */

type FlagMap = Record<string, boolean>;

let cache: FlagMap | null = null;
let inflight: Promise<FlagMap> | null = null;

function loadFlags(): Promise<FlagMap> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/flags", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { flags: {} }))
    .then((j) => {
      cache = (j?.flags as FlagMap) ?? {};
      return cache;
    })
    .catch(() => {
      // A flag read must never break the page; absent data means "use the fallback".
      cache = {};
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useFlag(id: string, fallback = false): boolean {
  const [on, setOn] = useState<boolean>(cache ? (cache[id] ?? fallback) : fallback);

  useEffect(() => {
    let alive = true;
    void loadFlags().then((flags) => {
      if (alive) setOn(flags[id] ?? fallback);
    });
    return () => {
      alive = false;
    };
  }, [id, fallback]);

  return on;
}

/** Test-only: drop the session cache so a fresh fetch runs on next `useFlag`. */
export function __resetFlagCache(): void {
  cache = null;
  inflight = null;
}
