"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { monetagAllowedOnPath, type MonetagTag } from "@/lib/monetization/monetag";

/**
 * Client-side, plan-gated injection of the Monetag tags.
 *
 * ── Why the gate is here and not in the layout ────────────────────────────────
 *
 * Pro / Business are ad-free, so Monetag must not load for them. The obvious place
 * to check the plan is the server `<head>`, but the root layout renders the static,
 * CDN-cached marketing pages too — reading the session there (cookies) would
 * un-static every one of them, the exact defect that cost `/` its edge caching.
 *
 * So the plan is resolved on the CLIENT, exactly like every placed ad already is
 * (`useEntitlements` → `showAds`, with the same signed-out fast path so anonymous
 * downloader traffic — the overwhelming majority — resolves without a round trip).
 * Monetag's self-placing formats (in-page push, popunder, vignette, push) are then
 * injected only for visitors who should see ads, and never for a paying user.
 *
 * ── Injected via the DOM, once ────────────────────────────────────────────────
 *
 * The scripts are appended to `document.head` as real elements (React does not
 * execute a `<script src>` added through JSX), with `src` set from the
 * server-validated https URL — never from a raw snippet, so nothing here can
 * become an injection vector. A module-level guard makes it happen at most once
 * per page load, surviving StrictMode's double-invoke and any remount.
 *
 * ── Waits for the truth before injecting ──────────────────────────────────────
 *
 * Injection is gated on `ready && showAds`: until entitlements resolve, `showAds`
 * is optimistically `true` but `ready` is false, so a premium user is never served
 * a tag in the gap before `/api/me` answers. Failing closed (no ad) is the safe
 * direction; the signed-out fast path keeps it instant for everyone else.
 */

const injected = new Set<string>();

export function MonetagTags({
  tags,
  allPages,
  surfaces,
}: {
  tags: MonetagTag[];
  allPages: boolean;
  surfaces: string[];
}) {
  const { showAds, ready } = useEntitlements();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready || !showAds || tags.length === 0) return;
    if (typeof document === "undefined") return;
    // WHERE: only on the pages the owner scoped Monetag to (all pages by default).
    if (!monetagAllowedOnPath(pathname ?? "/", { monetagAllPages: allPages, monetagSurfaces: surfaces })) return;

    for (const tag of tags) {
      const key = `${tag.src}|${tag.zone ?? ""}`;
      if (injected.has(key)) continue;
      injected.add(key);

      const el = document.createElement("script");
      el.async = true;
      // `tag.src` is a server-validated https URL (see parseMonetagSnippet); a raw
      // snippet never reaches the client, so this cannot inject anything.
      el.src = tag.src;
      el.setAttribute("data-monetag", tag.type);
      if (tag.zone) el.setAttribute("data-zone", tag.zone);
      if (tag.cfAsync) el.setAttribute("data-cfasync", "false");
      document.head.appendChild(el);
    }
  }, [ready, showAds, tags, pathname, allPages, surfaces]);

  return null;
}
