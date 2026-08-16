"use client";

import { AlertCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Downloader } from "@/features/downloader/downloader";
import {
  getHeroLink,
  getServerHeroLink,
  setHeroLink,
  subscribeHeroLink,
} from "@/features/downloader/hero-link-store";
import { extractSharedUrl } from "@/lib/share-target";
import { sourceUrlSchema } from "@/lib/validation";

/**
 * The result of a link submitted from the hero CTA — shown right where the
 * visitor was looking.
 *
 * ── THREE entry points, ONE result (owner, 2026-08-09 origin; folded back
 *    together 2026-08-16 when the second paste tool was removed) ──────────────
 *
 * This used to split two ways on purpose — a typed hero submit rendered here,
 * under Wallpaper Gallery, while a PWA Share Target hand-off (`?url=`/`?text=`,
 * the parameters Android/iOS hand a web app when something is shared INTO it
 * from TikTok/Instagram/etc) rendered inside a second, separate "Download
 * anything" card further down the page. That second card is gone (owner,
 * 2026-08-16: "remove the below download section" — the page now has exactly
 * one paste tool, matching the Download page it mirrors), so there is no
 * longer a second place for a share-target hand-off to render INTO. It renders
 * here now, same as every other way a link reaches this page:
 *
 *   the hero CTA's own submit  → the store below
 *   a PWA share-target hand-off → `?url=` / `?text=`, via `extractSharedUrl`
 *   a pre-hydration/no-JS submit → `?paste=`, the form's own GET fallback
 *
 * All three resolve to the same `raw` link below and render in this one panel.
 *
 * ── Instant, with no navigation ───────────────────────────────────────────────
 * The link arrives through a module-level store, so submitting the CTA is a
 * `setState` and a fetch — no route change, no page-transition animation, no
 * reload (owner: "it shouldn't refresh, it should show instantly the review
 * modal below").
 *
 * `?paste=` is still read as a fallback: it is what the form submits before
 * hydration and with JavaScript disabled, and it makes a result shareable as a
 * link. Store first, URL second — so a fresh submit always beats a stale query
 * string left in the address bar.
 *
 * ── Why the Downloader is keyed on the url ────────────────────────────────────
 * `Downloader` fetches `initialUrl` once, on mount. Without the key, pasting a
 * SECOND link would update the prop and fetch nothing, leaving the first
 * result on screen — which looks exactly like the button being broken.
 *
 * ── Why it renders nothing until there is a link ──────────────────────────────
 * Most visitors never submit anything, and an empty panel wedged between the CTA
 * stack and the trust row would push the page down for all of them to serve
 * none. No link, no markup, no layout.
 *
 * Must sit inside <Suspense>: useSearchParams() suspends during prerender, and
 * that boundary is what keeps `/` statically generated. Its fallback is `null`,
 * which is also the no-link state, so the static HTML and the hydrated page
 * agree and nothing shifts.
 */
export function HeroLinkDownloader() {
  const submitted = useSyncExternalStore(subscribeHeroLink, getHeroLink, getServerHeroLink);
  const params = useSearchParams();
  const fromUrl = params.get("paste")?.trim() ?? "";
  // The PWA Share Target hand-off — validated the same way `extractSharedUrl`
  // always has, so a malformed or unsafe value is dropped rather than reaching
  // `Downloader` unchecked (see lib/share-target.ts).
  const fromShare = extractSharedUrl({ url: params.get("url"), text: params.get("text") }) ?? "";

  /*
    🔴 A submission is CONSUMED, not remembered (owner, 2026-08-09: "the hero
    section placeholder auto-fetches when I back-swipe from any page to the
    landing page").

    Exactly what a module-level store does if nobody clears it: the link stayed
    set for the whole session, so every later return to `/` — a back swipe, the
    logo, the bottom nav — remounted this component with the old value and
    re-ran the extraction. An action the visitor performed once was being
    replayed every time they walked past it.

    So the store hands the link over and is emptied in the same breath. What is
    on screen lives in local state, which dies with the page, and a fresh
    submit refills the store. Coming back to the landing now shows the landing.

    Clearing on UNMOUNT would have been the obvious version and it is wrong:
    React's Strict Mode mounts, unmounts and remounts in development, which
    would wipe the link immediately after every submit. Consuming on arrival
    behaves identically in both.
  */
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!submitted) return;
    setShown(submitted);
    setHeroLink("");
  }, [submitted]);

  const raw = shown || fromShare || fromUrl;
  if (!raw) return null;

  /*
    Validated with the same schema the server uses, because `Downloader` treats
    `initialUrl` as already-checked and fetches it on mount. A typo or a
    truncated `?paste=` would otherwise reach the extractor and come back as a
    generic failure instead of a sentence that says what is wrong.
  */
  const parsed = sourceUrlSchema.safeParse(raw);

  return (
    /*
      `overflow-hidden` plus `min-w-0` so nothing inside can set the width of the
      hero's grid column — a wide format row used to stretch the whole track and
      push the page past the viewport on a phone. The negative top margin cancels
      the result card's own `mt-10`, which is spacing for a card that sits alone
      under a paste box, not one tucked into a CTA stack.
    */
    <div id="hero-result" className="min-w-0 -mb-6 overflow-hidden scroll-mt-28 [&>div>div]:mt-4">
      {parsed.success ? (
        <Downloader key={parsed.data} initialUrl={parsed.data} resultOnly heroHandlesFetching />
      ) : (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-4 text-left"
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/12 text-red-500">
            <AlertCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">That doesn&apos;t look like a link</p>
            <p className="mt-0.5 break-words text-xs text-slate-600 dark:text-white/60">
              {parsed.error.issues[0]?.message ?? "Paste the full address of the post, starting with https://"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
