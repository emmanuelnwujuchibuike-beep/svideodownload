"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { useMonetagInPagePush } from "@/features/monetization/use-monetag-inpage-push";
import { reportMonetagFormatRequested } from "@/features/monetization/monetag-report";
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
 *
 * ── In-Page Push gets an EXTRA daily frequency cap ────────────────────────────
 *
 * Every other Monetag format above loads unconditionally (once per page load) —
 * Monetag's own self-placing logic decides how often it actually shows an ad
 * from there. In-Page Push is different: the owner wants a hard ceiling of at
 * most `DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT` (5) SCRIPT LOADS per visitor per local
 * day, since reloading its script on every page view is what let it show far
 * more often than intended. So `in_page_push` tags are split out of the
 * unconditional loop and routed through `useMonetagInPagePush` instead (see that
 * file for the full frequency-cap mechanism) — every other format is completely
 * unaffected by this change.
 */

const injected = new Set<string>();

export function MonetagTags({
  tags,
  allPages,
  surfaces,
  inPagePushDailyLimit,
}: {
  tags: MonetagTag[];
  allPages: boolean;
  surfaces: string[];
  /** Admin-set ceiling on In-Page Push tag loads per local day. */
  inPagePushDailyLimit?: number;
}) {
  const { showAds, ready } = useEntitlements();
  const pathname = usePathname();

  // Shared by both the standard-tags effect below AND the In-Page Push gate —
  // computed once so the two paths can never disagree about whether this
  // visitor, on this page, should see Monetag at all.
  const allowed = ready && showAds && monetagAllowedOnPath(pathname ?? "/", { monetagAllPages: allPages, monetagSurfaces: surfaces });

  const inPagePushTags = useMemo(() => tags.filter((t) => t.type === "in_page_push"), [tags]);
  const standardTags = useMemo(() => tags.filter((t) => t.type !== "in_page_push"), [tags]);

  // Every Monetag format EXCEPT In-Page Push — unchanged from before: loads
  // once per page load, no daily cap (Monetag's own logic governs cadence).
  useEffect(() => {
    if (!allowed || standardTags.length === 0) return;
    if (typeof document === "undefined") return;

    for (const tag of standardTags) {
      const key = `${tag.src}|${tag.zone ?? ""}`;
      if (injected.has(key)) continue;
      injected.add(key);

      const el = document.createElement("script");
      el.async = true;
      el.src = tag.src;
      el.setAttribute("data-monetag", tag.type);
      if (tag.zone) el.setAttribute("data-zone", tag.zone);
      if (tag.cfAsync) el.setAttribute("data-cfasync", "false");
      document.head.appendChild(el);
      /*
        The denominator. A format requested on every page that never draws is
        a dead zone, and that is invisible in the admin without this row. It is
        deliberately NOT counted as an impression — see monetag-track.ts.
      */
      reportMonetagFormatRequested(tag.type);
    }
  }, [allowed, standardTags]);

  return (
    <>
      {inPagePushTags.map((tag) => (
        <InPagePushGate
          key={`${tag.src}|${tag.zone ?? ""}`}
          tag={tag}
          enabled={allowed}
          dailyLimit={inPagePushDailyLimit}
        />
      ))}
    </>
  );
}

/**
 * One In-Page Push tag, frequency-capped at `DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT`
 * loads per local day. A separate component (rather than calling the hook
 * inline in `MonetagTags`) so the number of tags can vary at runtime without
 * ever violating the rules of hooks — each tag gets its own hook instance.
 */
function InPagePushGate({
  tag,
  enabled,
  dailyLimit,
}: {
  tag: MonetagTag;
  enabled: boolean;
  dailyLimit?: number;
}) {
  /*
    A limit of 0 means "no cap" in the admin, which the hook expresses as a very
    large number rather than a special case — every comparison in the cap module
    stays a plain `count >= limit`.
  */
  useMonetagInPagePush(tag, {
    enabled,
    ...(typeof dailyLimit === "number"
      ? { dailyLimit: dailyLimit === 0 ? Number.MAX_SAFE_INTEGER : dailyLimit }
      : {}),
  });
  return null;
}
