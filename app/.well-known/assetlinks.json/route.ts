import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Digital Asset Links — what makes the Android app open as an APP.
 *
 * ── Why this file decides whether the APK feels native ────────────────────────
 * The Frenzsave Android app is a Trusted Web Activity (TWA): a thin Android
 * shell that runs this exact PWA full-screen. Android will only hide the browser
 * address bar if it can PROVE the app and the website belong to the same owner,
 * and this file is that proof. Without it the APK still installs and still runs
 * — but with a Chrome URL bar pinned across the top, which is precisely the
 * "why does it look like a browser" complaint a wrapped PWA gets.
 *
 * Verification is done by Android at install/first-launch by fetching
 * `https://frenzsave.com/.well-known/assetlinks.json` and checking that the
 * signing certificate of the installed APK matches a fingerprint listed here.
 * It is a plain, public, unauthenticated file by design — there is nothing
 * secret in it, and it must be reachable with no cookie, no redirect and no
 * middleware in the way (see the matcher note in middleware.ts).
 *
 * ── Why it is configured, not hard-coded ──────────────────────────────────────
 * The package name and SHA-256 fingerprint are properties of the SIGNED APK,
 * which is produced outside this repo (PWABuilder or Bubblewrap) with a keystore
 * that must never be committed. Baking a placeholder fingerprint in would be
 * worse than having none: Android would fetch a file that looks valid, fail the
 * match, and show the URL bar anyway with nothing indicating why.
 *
 * If Play App Signing is enabled — it is on by default for new apps — Google
 * re-signs the upload, so the fingerprint that matters is the one Play shows
 * under "App signing key certificate", NOT the local keystore's. Both can be
 * listed; `ANDROID_CERT_FINGERPRINTS` accepts a comma-separated list precisely
 * so the upload key and the Play signing key can coexist during a migration.
 *
 * ── Returns an empty array until configured ───────────────────────────────────
 * An empty `[]` is valid JSON and a valid (if useless) asset-links document.
 * Serving that rather than a 404 keeps the endpoint present and inspectable, so
 * an operator checking the URL sees "configured: no" instead of a dead route
 * they might assume was never deployed.
 */

const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME?.trim() ?? "";
const FINGERPRINTS = (process.env.ANDROID_CERT_FINGERPRINTS ?? "")
  .split(",")
  .map((f) => f.trim().toUpperCase())
  // A SHA-256 fingerprint is 32 colon-separated hex bytes. Filtering on shape
  // stops a stray blank or a half-pasted value producing a malformed entry that
  // Android rejects wholesale — one bad line would otherwise invalidate the
  // good one next to it.
  .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));

export function GET() {
  const statements =
    PACKAGE_NAME && FINGERPRINTS.length > 0
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: PACKAGE_NAME,
              sha256_cert_fingerprints: FINGERPRINTS,
            },
          },
        ]
      : [];

  return NextResponse.json(statements, {
    headers: {
      // Android caches this, and a stale copy after a signing-key change is a
      // URL bar nobody can explain. Short enough to recover from that within a
      // day, long enough that it is not fetched on every launch.
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json",
    },
  });
}
