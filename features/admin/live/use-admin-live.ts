"use client";

import { useEffect, useRef, useState } from "react";

import { subscribe, type Tier } from "./scheduler";

/**
 * The hook every admin widget uses instead of its own `setInterval`.
 *
 * One line at the call site, and the widget inherits all of the scheduler's
 * guarantees: shared requests, a hard stop while the tab is hidden, backoff on
 * failure, and teardown on unmount. See `scheduler.ts` for why those exist.
 *
 * `key` identifies the DATA, not the component. Two widgets that want the same
 * endpoint must pass the same key — that is what makes them share one request
 * rather than each opening their own loop.
 */
export function useAdminLive<T>({
  key,
  tier,
  fetcher,
  initial = null,
}: {
  key: string;
  tier: Tier;
  fetcher: () => Promise<T>;
  initial?: T | null;
}): { data: T | null; error: unknown; stale: boolean } {
  const [data, setData] = useState<T | null>(initial);
  const [error, setError] = useState<unknown>(null);
  /*
    The fetcher is captured in a ref so an inline arrow at the call site — which
    is a new function on every render — does not tear the subscription down and
    build it up again on each render. That re-subscribe loop would defeat the
    whole point: every rebuild triggers an immediate fetch.
  */
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    return subscribe(
      key,
      tier,
      () => fetcherRef.current(),
      (value, err) => {
        if (err) {
          // Keep the last good snapshot on screen rather than blanking the
          // widget — an operator reading a number wants the stale one labelled,
          // not replaced by an error state.
          setError(err);
          return;
        }
        setError(null);
        setData(value as T);
      },
    );
  }, [key, tier]);

  return { data, error, stale: error !== null && data !== null };
}

/** JSON GET helper — every admin endpoint answers the same shape. */
export async function adminJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
