/**
 * Pure decisions behind the chunk-error screen in error-fallback.tsx, kept
 * DOM-free so they can be tested in the node Vitest environment.
 *
 * 🔴 Owner report (2026-10-14): "A new version is ready" showed with NO deploy,
 * after leaving the app in the background and coming back. Safari's message for
 * ANY failed dynamic `import()` is "Importing a module script failed", and that
 * includes a plain network drop. iOS often fails the first requests after a
 * resume, so a lazy chunk fetched at that moment looked like a stale deploy.
 * Two fixes:
 *  1. The headline says "new version" only when /api/app-version reports a build
 *     different from the one baked into this bundle. Otherwise it's a connection
 *     blip and the copy says so.
 *  2. The one-auto-reload guard was a per-session flag that was never cleared.
 *     An installed iOS PWA keeps one session for days, so after the FIRST
 *     auto-reload every later blip showed the screen. It is now a timestamp with
 *     a cooldown: it still stops a reload loop on a broken deploy without
 *     disabling recovery for the rest of the session.
 */

export const CHUNK_RELOAD_KEY = "frenz:chunk-error-reload";
/** A second chunk failure within this window of an auto-reload means the reload
 * didn't help, so show the screen instead of looping. */
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

export function isChunkLoadError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /loading chunk|loading css chunk|failed to fetch dynamically imported module|importing a module script failed/i.test(
      error.message ?? "",
    )
  );
}

/** `lastReloadAt` is the stored value: null if never set, otherwise a ms timestamp
 * as a string. The legacy value "1" (the old flag) parses as an ancient time, so
 * it allows a reload too. */
export function shouldAutoReload(lastReloadAt: string | null, now: number): boolean {
  if (lastReloadAt == null) return true;
  const at = Number(lastReloadAt);
  if (!Number.isFinite(at)) return true;
  return now - at > CHUNK_RELOAD_COOLDOWN_MS || at > now;
}

/** True only when the server build is known AND differs from this bundle's. An
 * unknown result (offline, timeout, or no baked stamp) counts as a connection
 * blip, never as an update. */
export function isNewDeploy(bakedBuild: string, serverBuild: string | undefined): boolean {
  return !!bakedBuild && !!serverBuild && serverBuild !== bakedBuild;
}
