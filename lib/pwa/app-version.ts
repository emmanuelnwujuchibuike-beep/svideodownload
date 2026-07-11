"use client";

/**
 * Shared "what build is the server on" primitive — was independently
 * hand-duplicated in register-sw.tsx (throttled, drives an actual reload)
 * and lib/observability/diagnostics.ts (a passive one-off read). Both now
 * wrap this instead of re-implementing the fetch+parse themselves.
 */
export const BAKED_APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";

/** Returns the server's current build stamp, or undefined on any failure
 * (offline, non-2xx, malformed body, or a stalled connection) — callers
 * decide what "unknown" means.
 *
 * The 8s AbortController timeout matters beyond just this one call: a hung
 * fetch (a broken proxy, a socket that never resolves or rejects) with no
 * timeout would leave register-sw.tsx's `versionCheckInFlight` guard stuck
 * `true` forever, silently disabling the "check for a new deploy" loop for
 * the rest of the tab's life — invisible, and easy to mistake for the app
 * being permanently stuck on stale code after an update. */
export async function fetchServerBuild(): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("/api/app-version", { cache: "no-store", signal: controller.signal });
    if (!res.ok) return undefined;
    const { build } = (await res.json()) as { build?: string };
    return build;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
