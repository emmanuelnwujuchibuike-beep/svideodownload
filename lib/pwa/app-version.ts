"use client";

/**
 * Shared "what build is the server on" primitive — was independently
 * hand-duplicated in register-sw.tsx (throttled, drives an actual reload)
 * and lib/observability/diagnostics.ts (a passive one-off read). Both now
 * wrap this instead of re-implementing the fetch+parse themselves.
 */
export const BAKED_APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";

/** Returns the server's current build stamp, or undefined on any failure
 * (offline, non-2xx, malformed body) — callers decide what "unknown" means. */
export async function fetchServerBuild(): Promise<string | undefined> {
  try {
    const res = await fetch("/api/app-version", { cache: "no-store" });
    if (!res.ok) return undefined;
    const { build } = (await res.json()) as { build?: string };
    return build;
  } catch {
    return undefined;
  }
}
