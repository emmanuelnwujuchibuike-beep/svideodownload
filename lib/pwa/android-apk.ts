"use client";

/**
 * The Android APK download path (owner, 2026-08-23: "clicking the existing
 * Install App button must download the official Frenzsave APK").
 *
 * ── Why availability is CHECKED and not assumed ───────────────────────────────
 * The owner's brief is explicit that the implementation "does not cause a broken
 * download link to appear as a successful installation", and that no placeholder
 * APK should be invented. Both are the same requirement seen from two sides: the
 * file may legitimately not be there yet, and navigating to a missing path would
 * hand an Android user a 404 page or a 0-byte file while our UI says "starting
 * your download". A HEAD request costs one round trip and turns that silent
 * failure into an honest fallback to the manual install instructions.
 *
 * `HEAD` rather than `GET` on purpose — this asks "does it exist" without
 * pulling the APK's bytes, which on a phone is the whole point.
 */

export const ANDROID_APK_PATH = "/downloads/frenzsave.apk";

/**
 * Whether the APK is actually served. `false` on any failure — a network error,
 * a non-2xx, or a blocked request — because every one of those means we cannot
 * promise the download, and promising it anyway is the exact failure the check
 * exists to prevent.
 */
export async function apkAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(ANDROID_APK_PATH, { method: "HEAD", signal });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start the APK download.
 *
 * An anchor with `download`, clicked programmatically, rather than
 * `location.href = …`. On Android browsers a same-origin navigation to a binary
 * can leave the user on a blank page while the file transfers; an anchor keeps
 * them on the page they were reading and hands the transfer to the download
 * manager, which is where an APK install actually continues from.
 *
 * `rel="noopener"` is belt-and-braces on a same-origin link with no target, and
 * the element is removed immediately — this leaves no DOM behind and nothing
 * for a later render to trip over.
 */
export function startApkDownload(): void {
  const a = document.createElement("a");
  a.href = ANDROID_APK_PATH;
  a.download = "frenzsave.apk";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
